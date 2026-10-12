import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuctionChannel } from '../auctionChannel'
import type { WsMessage } from '@/types'

vi.mock('@/api/auction', () => ({
  listEventsApi: vi.fn(),
  getAuctionApi: vi.fn(),
}))

import { listEventsApi } from '@/api/auction'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(text: string) {
    this.sent.push(text)
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }

  // 测试辅助
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  message(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }

  drop(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

function envelope(partial: Partial<WsMessage> & { type: WsMessage['type']; seq: number }): WsMessage {
  return { auctionId: 1, serverTime: 1, ...partial } as WsMessage
}

function makeChannel(onEvent: (m: WsMessage) => void) {
  return new AuctionChannel(
    1,
    'tok',
    { onEvent, onStatus: undefined },
    (url) => new FakeWebSocket(url) as unknown as WebSocket,
  )
}

describe('AuctionChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.mocked(listEventsApi).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('连接后接收快照与顺序事件，重复 seq 事件被丢弃', () => {
    const events: WsMessage[] = []
    const ch = makeChannel((m) => events.push(m))
    ch.seedSeq(0)
    ch.connect()
    const ws = FakeWebSocket.instances[0]!
    ws.open()

    ws.message(envelope({ type: 'AUCTION_SNAPSHOT', seq: 1, status: 'RUNNING' }))
    ws.message(envelope({ type: 'BID_ACCEPTED', seq: 2, bidderId: 5, amount: 110 }))
    ws.message(envelope({ type: 'BID_ACCEPTED', seq: 2, bidderId: 5, amount: 110 })) // 重复
    ws.message(envelope({ type: 'BID_ACCEPTED', seq: 3, bidderId: 6, amount: 120 }))

    expect(events.map((e) => e.type)).toEqual(['AUCTION_SNAPSHOT', 'BID_ACCEPTED', 'BID_ACCEPTED'])
    expect(ws.sent).toEqual([]) // 无缺口不 SYNC
    expect(ch.currentSeq).toBe(3)

    ch.close()
  })

  it('检测到 seq 缺口时自动发送 SYNC:<lastSeq>', () => {
    const events: WsMessage[] = []
    const ch = makeChannel((m) => events.push(m))
    ch.seedSeq(2)
    ch.connect()
    const ws = FakeWebSocket.instances[0]!
    ws.open()

    ws.message(envelope({ type: 'BID_ACCEPTED', seq: 5, bidderId: 5, amount: 150 }))

    expect(ws.sent).toContain('SYNC:2')
    // Strengthened: sending SYNC alone must not advance across missing events.
    expect(ch.currentSeq).toBe(2)
    expect(events).toHaveLength(0)
    ws.message(envelope({ type: 'AUCTION_SNAPSHOT', seq: 5, status: 'RUNNING' }))
    expect(ch.currentSeq).toBe(5)
    expect(events.map(e => e.type)).toEqual(['AUCTION_SNAPSHOT'])

    ch.close()
  })

  it('非用户关闭时按退避自动重连，重连成功后 SYNC 补齐', () => {
    const ch = makeChannel(vi.fn())
    ch.connect()
    const ws1 = FakeWebSocket.instances[0]!
    ws1.open()
    ch.seedSeq(4)

    ws1.drop(1006) // 网络断开
    expect(ch.status).toBe('reconnecting')

    vi.advanceTimersByTime(20_000)
    expect(FakeWebSocket.instances.length).toBe(2)
    const ws2 = FakeWebSocket.instances[1]!
    ws2.open()
    expect(ch.status).toBe('connected')
    expect(ws2.sent).toContain('SYNC:4') // 重连后主动补发

    ch.close()
  })

  it('WS 不可用时 sync() 走 HTTP 事件回放兜底', async () => {
    vi.mocked(listEventsApi).mockResolvedValueOnce([
      {
        seq: 3,
        payload: JSON.stringify({
          type: 'AUCTION_FINISHED',
          auctionId: 1,
          seq: 0,
          serverTime: 99,
          reason: 'EXPIRED',
          winnerId: 2,
          finalPrice: 150,
        }),
      },
    ])
    const events: WsMessage[] = []
    const ch = makeChannel((m) => events.push(m))
    ch.seedSeq(2)

    await ch.sync()

    expect(listEventsApi).toHaveBeenCalledWith(1, 2)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('AUCTION_FINISHED')
    expect(ch.currentSeq).toBe(3)
  })

  it('close 后不再重连', () => {
    const ch = makeChannel(vi.fn())
    ch.connect()
    const ws1 = FakeWebSocket.instances[0]!
    ws1.open()
    ch.close()

    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances.length).toBe(1)
    expect(ch.status).toBe('closed')
  })
})
