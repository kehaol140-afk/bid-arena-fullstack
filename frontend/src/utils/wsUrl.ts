/** 构造拍卖 WS 地址：ws://<host>:8091/ws/auction?token=..&auctionId=.. */
export function buildAuctionWsUrl(auctionId: number, token: string): string {
  const configured = import.meta.env.VITE_WS_BASE
  const base =
    configured ||
    `${typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
      typeof location !== 'undefined' ? location.hostname : 'localhost'
    }:8091`
  return `${base.replace(/\/$/, '')}/ws/auction?token=${encodeURIComponent(token)}&auctionId=${auctionId}`
}
