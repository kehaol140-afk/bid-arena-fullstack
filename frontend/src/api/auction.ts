import { request } from './http'
import type {
  Auction,
  AuctionEventRecord,
  Bid,
  PlaceBidRequest,
  PlaceBidResponse,
} from '@/types'

/** 列表（id 倒序），元素 participants 为空但含 participantCount */
export function listAuctionsApi(): Promise<Auction[]> {
  return request<Auction[]>({ method: 'get', url: '/api/v1/auctions' })
}

export function getAuctionApi(id: number): Promise<Auction> {
  return request<Auction>({ method: 'get', url: `/api/v1/auctions/${id}` })
}

/** 仅 RUNNING 可加入；重复 join 幂等成功 */
export function joinAuctionApi(id: number): Promise<null> {
  return request<null>({ method: 'post', url: `/api/v1/auctions/${id}/join` })
}

/** 核心：出价。requestId 客户端生成（UUID），同号同金额幂等重放 */
export function placeBidApi(id: number, payload: PlaceBidRequest): Promise<PlaceBidResponse> {
  return request<PlaceBidResponse>({ method: 'post', url: `/api/v1/auctions/${id}/bids`, data: payload })
}

/** 出价历史（seq 倒序，最多 200） */
export function listBidsApi(id: number): Promise<Bid[]> {
  return request<Bid[]>({ method: 'get', url: `/api/v1/auctions/${id}/bids` })
}

/** 持久化事件回放（HTTP 兜底，seq 缺口恢复用） */
export function listEventsApi(id: number, since = 0): Promise<AuctionEventRecord[]> {
  return request<AuctionEventRecord[]>({ method: 'get', url: `/api/v1/auctions/${id}/events`, params: { since } })
}
