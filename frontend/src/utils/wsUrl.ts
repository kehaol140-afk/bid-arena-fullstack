/** 默认经页面同源Vite/Nginx代理，也可显式配置VITE_WS_BASE。 */
export function buildAuctionWsUrl(auctionId: number, token: string): string {
  const configured = import.meta.env.VITE_WS_BASE
  const base =
    configured ||
    `${typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
      typeof location !== 'undefined' ? location.hostname : 'localhost'
    }${typeof location !== 'undefined' && location.port ? `:${location.port}` : ''}`
  return `${base.replace(/\/$/, '')}/ws/auction?token=${encodeURIComponent(token)}&auctionId=${auctionId}`
}
