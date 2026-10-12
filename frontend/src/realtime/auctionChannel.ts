import { getAuctionApi, listEventsApi } from '@/api/auction'
import type { WsMessage } from '@/types'
import { buildAuctionWsUrl } from '@/utils/wsUrl'

export type ChannelStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'rejected' | 'closed'

export interface ChannelCallbacks {
  onEvent: (msg: WsMessage) => void
  onStatus?: (status: ChannelStatus, detail?: string) => void
}

const HEARTBEAT_INTERVAL_MS = 25_000
const MAX_BACKOFF_MS = 15_000

/**
 * 单场拍卖的实时通道：
 * - 连接即收 AUCTION_SNAPSHOT（权威全量状态）
 * - seq 单调：发现缺口 → 优先 SYNC:<lastSeq>，通道不可用时 HTTP /events 兜底回放
 * - 断线指数退避自动重连（1s 起、上限 15s、含抖动），重连成功重置
 * - 25s 心跳 PING
 * - 状态事件去重；拒绝其他房间与过旧快照，缺口期间等待权威快照
 */
export class AuctionChannel {
  private ws: WebSocket | null = null
  private lastSeq = 0
  private attempts = 0
  private closedByUser = false
  private reconnectTimer: number | undefined
  private heartbeatTimer: number | undefined
  private recovering = false
  private awaitingSnapshot = false

  constructor(
    private readonly auctionId: number,
    private readonly token: string,
    private readonly callbacks: ChannelCallbacks,
    private readonly wsFactory: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  get status(): ChannelStatus {
    return this._status
  }

  private _status: ChannelStatus = 'idle'

  private setStatus(s: ChannelStatus, detail?: string) {
    this._status = s
    this.callbacks.onStatus?.(s, detail)
  }

  get currentSeq(): number {
    return this.lastSeq
  }

  /** 用服务端已知 seq 初始化（如 detail.seq），避免误报缺口 */
  seedSeq(seq: number) {
    if (seq > this.lastSeq) this.lastSeq = seq
  }

  connect() {
    if (this.closedByUser) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.clearTimers()
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = this.wsFactory(buildAuctionWsUrl(this.auctionId, this.token))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.setStatus('connected')
      this.startHeartbeat()
      // 重连后主动 SYNC 一次，补齐离线期间事件（服务端也会推快照，双保险）
      if (this.lastSeq > 0) this.sendRaw(`SYNC:${this.lastSeq}`)
    }

    ws.onmessage = (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      if (!raw || raw === 'PONG') return
      let msg: unknown
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      this.dispatch(msg as WsMessage)
    }

    ws.onclose = (ev: CloseEvent) => {
      this.stopHeartbeat()
      this.ws = null
      if (this.closedByUser) {
        this.setStatus('closed')
        return
      }
      // 服务端拒绝（如 token 无效）：不重连
      if (ev.code === 4001 || ev.reason?.includes('rejected')) {
        this.setStatus('rejected', ev.reason)
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose 会跟随触发，统一在 onclose 处理
    }
  }

  close() {
    this.closedByUser = true
    this.clearTimers()
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onmessage = null
      this.ws.onerror = null
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.setStatus('closed')
  }

  /** 客户端主动触发补发：优先 WS SYNC，不可用走 HTTP 事件回放 */
  sync() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw(`SYNC:${this.lastSeq}`)
      return
    }
    void this.recoverViaHttp()
  }

  private dispatch(msg: WsMessage) {
    if (!msg || typeof msg.type !== 'string' || msg.auctionId !== this.auctionId) return
    const seq = Number(msg.seq ?? 0)
    const stateful =
      msg.type !== 'CONNECTION_STATE' &&
      msg.type !== 'BID_REJECTED' &&
      msg.type !== 'AUCTION_SNAPSHOT'

    if (stateful) {
      if (this.awaitingSnapshot) return
      if (seq <= this.lastSeq) return // 重复事件（SYNC 补发重叠）丢弃
      if (seq > this.lastSeq + 1) {
        // 缺口：自动恢复
        this.sync()
        this.awaitingSnapshot = true
        void this.recoverSnapshot()
        return
      }
      this.lastSeq = seq
    } else if (msg.type === 'AUCTION_SNAPSHOT') {
      if (seq < this.lastSeq) return
      this.awaitingSnapshot = false
      if (seq > this.lastSeq) this.lastSeq = seq
    }

    this.callbacks.onEvent(msg)
  }

  private async recoverSnapshot() {
    try {
      const a = await getAuctionApi(this.auctionId)
      if (this.closedByUser) return
      this.dispatch({ ...a, type: 'AUCTION_SNAPSHOT', auctionId: a.id,
        startTime: a.startedAt, serverTime: Date.now() } as WsMessage)
    } catch {
      // WS SYNC/reconnect and the room's HTTP polling can still recover authority.
    }
  }

  /** HTTP 兜底：拉取 since=lastSeq 的持久化事件并回放 */
  private async recoverViaHttp() {
    if (this.recovering) return
    this.recovering = true
    try {
      const records = await listEventsApi(this.auctionId, this.lastSeq)
      for (const rec of records) {
        let payload: unknown
        try {
          payload = JSON.parse(rec.payload)
        } catch {
          continue
        }
        const msg = payload as WsMessage
        if (msg && typeof msg.type === 'string') {
          msg.seq = rec.seq
          this.dispatch(msg)
        }
      }
    } catch {
      // 网络不可用：等待下一轮重连
    } finally {
      this.recovering = false
    }
  }

  private sendRaw(text: string) {
    try {
      this.ws?.send(text)
    } catch {
      // ignore
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => this.sendRaw('PING'), HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts) + Math.floor(Math.random() * 500)
    this.attempts += 1
    this.setStatus('reconnecting')
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
  }

  private clearTimers() {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }
}
