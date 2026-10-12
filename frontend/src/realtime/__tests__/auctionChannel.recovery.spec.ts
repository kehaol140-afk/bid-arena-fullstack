import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { AuctionChannel } from '../auctionChannel'
import type { WsMessage } from '@/types'

vi.mock('@/api/auction', () => ({ listEventsApi: vi.fn(), getAuctionApi: vi.fn() }))
import { getAuctionApi } from '@/api/auction'

class Socket {
  readyState = WebSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror = null
  send(text: string) { this.sent.push(text) }
  close() { this.onclose?.() }
  message(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

describe('authoritative gap recovery regressions', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(getAuctionApi).mockReset() })
  afterEach(() => vi.useRealTimers())

  it('does not apply an event across a gap before the authoritative snapshot', () => {
    // Keep HTTP pending: server may also answer the WS SYNC with a snapshot.
    vi.mocked(getAuctionApi).mockImplementation(() => new Promise(() => {}))
    const events: WsMessage[] = []
    const socket = new Socket()
    const ch = new AuctionChannel(1, 'fixture', { onEvent: m => events.push(m) }, () => socket as unknown as WebSocket)
    ch.seedSeq(2); ch.connect(); socket.onopen?.()
    socket.message({ type: 'BID_ACCEPTED', auctionId: 1, seq: 5, serverTime: 1, amount: 150 })
    expect(ch.currentSeq).toBe(2)
    expect(events).toHaveLength(0)
    socket.message({ type: 'AUCTION_SNAPSHOT', auctionId: 1, seq: 5, serverTime: 2, status: 'RUNNING', currentPrice: 150 })
    expect(ch.currentSeq).toBe(5)
    expect(events.map(e => e.type)).toEqual(['AUCTION_SNAPSHOT'])
    ch.close()
  })

  it('rejects another auction and stale snapshots', () => {
    const events: WsMessage[] = []; const socket = new Socket()
    const ch = new AuctionChannel(1, 'fixture', { onEvent: m => events.push(m) }, () => socket as unknown as WebSocket)
    ch.seedSeq(5); ch.connect()
    socket.message({ type: 'BID_ACCEPTED', auctionId: 2, seq: 6, serverTime: 1 })
    socket.message({ type: 'AUCTION_SNAPSHOT', auctionId: 1, seq: 3, serverTime: 2 })
    expect(ch.currentSeq).toBe(5); expect(events).toHaveLength(0)
    ch.close()
  })
})
