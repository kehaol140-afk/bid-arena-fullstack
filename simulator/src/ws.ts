/**
 * WebSocket 房间客户端（Node 22 原生 WebSocket）。
 * 协议见 API_CONTRACT.md §7：
 * - 连接即收 CONNECTION_STATE(connected) + AUCTION_SNAPSHOT
 * - 事件信封 {type, auctionId, seq, serverTime, ...}，seq 单场单调
 * - 可发 "SYNC:<lastSeq>" 补发缺口，"PING" 心跳
 */

export interface WsEnvelope {
  type: string;
  auctionId?: number;
  seq?: number;
  serverTime?: number;
  [k: string]: unknown;
}

export class WsClient {
  private ws: WebSocket | null = null;
  readonly envelopes: WsEnvelope[] = [];
  private waiters: { pred: (e: WsEnvelope) => boolean; resolve: (e: WsEnvelope) => void }[] = [];
  closedByUs = false;
  closeCode: number | null = null;

  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get lastSeq(): number {
    let max = 0;
    for (const e of this.envelopes) {
      const s = Number(e.seq ?? 0);
      if (Number.isFinite(s) && s > max) max = s;
    }
    return max;
  }

  async connect(url: string, openTimeoutMs = 5000): Promise<void> {
    const ws = new WebSocket(url);
    this.ws = ws;
    this.closedByUs = false;
    ws.onmessage = (ev: MessageEvent) => {
      let e: WsEnvelope;
      try {
        e = JSON.parse(String(ev.data)) as WsEnvelope;
      } catch {
        return;
      }
      this.envelopes.push(e);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i]!;
        if (w.pred(e)) {
          this.waiters.splice(i, 1);
          w.resolve(e);
        }
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: 连接超时`)), openTimeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error(`${this.name}: 连接失败`));
      };
    });
    await opened;
  }

  /** 等待满足条件的事件（仅新事件） */
  waitFor(pred: (e: WsEnvelope) => boolean, timeoutMs: number): Promise<WsEnvelope | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.pred === pred);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({
        pred: (e) => {
          if (pred(e)) {
            clearTimeout(t);
            return true;
          }
          return false;
        },
        resolve,
      });
    });
  }

  send(raw: string): void {
    if (!this.connected) throw new Error(`${this.name}: 未连接`);
    this.ws!.send(raw);
  }

  /** SYNC:<lastSeq> 补发；返回触发到收到新快照之间的所有事件 */
  async sync(lastSeq: number, timeoutMs = 5000): Promise<WsEnvelope[]> {
    const mark = this.envelopes.length;
    this.send(`SYNC:${lastSeq}`);
    const start = Date.now();
    // 等待 SYNC 之后到达的下一条 AUCTION_SNAPSHOT（replaySince 末尾必发）
    let idx = -1;
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
      for (let i = this.envelopes.length - 1; i >= mark; i--) {
        if (this.envelopes[i]!.type === "AUCTION_SNAPSHOT") {
          idx = i;
          break;
        }
      }
      if (idx >= 0) break;
    }
    return this.envelopes.slice(mark, idx >= 0 ? idx + 1 : undefined);
  }

  close(): void {
    this.closedByUs = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
