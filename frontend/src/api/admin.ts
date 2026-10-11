import { request } from './http'
import type {
  AdminCreateAuctionRequest,
  AdminCreateAuctionResponse,
  AgentTokenCreated,
  AgentTokenCreateRequest,
  AgentTokenInfo,
  Auction,
} from '@/types'

// ---------- 拍卖管理（ADMIN） ----------

export function createAuctionApi(payload: AdminCreateAuctionRequest): Promise<AdminCreateAuctionResponse> {
  return request<AdminCreateAuctionResponse>({ method: 'post', url: '/api/v1/admin/auctions', data: payload })
}

/** DRAFT→RUNNING，返回启动后的 detail（含 endTime） */
export function startAuctionApi(id: number): Promise<Auction> {
  return request<Auction>({ method: 'post', url: `/api/v1/admin/auctions/${id}/start` })
}

/** 仅 DRAFT/RUNNING 可取消；返回取消后的 detail */
export function cancelAuctionApi(id: number): Promise<Auction> {
  return request<Auction>({ method: 'post', url: `/api/v1/admin/auctions/${id}/cancel` })
}

// ---------- Agent Token 管理（ADMIN） ----------

/** 明文 token 仅此一次返回 */
export function createAgentTokenApi(payload: AgentTokenCreateRequest): Promise<AgentTokenCreated> {
  return request<AgentTokenCreated>({ method: 'post', url: '/api/v1/admin/agent-tokens', data: payload })
}

export function listAgentTokensApi(userId?: number): Promise<AgentTokenInfo[]> {
  return request<AgentTokenInfo[]>({
    method: 'get',
    url: '/api/v1/admin/agent-tokens',
    params: userId != null ? { userId } : undefined,
  })
}

export function revokeAgentTokenApi(id: number): Promise<null> {
  return request<null>({ method: 'post', url: `/api/v1/admin/agent-tokens/${id}/revoke` })
}
