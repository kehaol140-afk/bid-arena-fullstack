/**
 * 类型定义严格对齐 docs/API_CONTRACT.md（基准：backend 检查点提交）。
 * 约定：时间一律 epoch 毫秒（number）；金额一律整数积分（number）。
 */

/** 统一响应包装 */
export interface ApiResult<T> {
  code: number
  message: string
  data: T | null
}

// ---------- 认证与用户 ----------

export type UserRole = 'ADMIN' | 'USER' | 'AGENT'

export interface User {
  id: number
  email: string
  displayName: string
  role: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}

// ---------- 钱包 ----------

export interface Wallet {
  userId: number
  balance: number
  frozen: number
  available: number
}

export type LedgerType = 'FREEZE' | 'UNFREEZE' | 'PAY' | 'REFUND' | 'GRANT'

export interface LedgerEntry {
  id: number
  auctionId: number | null
  requestId: string | null
  type: LedgerType
  amount: number
  balanceAfter: number
  frozenAfter: number
  remark: string | null
  createdAt: number
}

// ---------- 拍卖 ----------

export type AuctionStatus = 'DRAFT' | 'RUNNING' | 'SETTLING' | 'FINISHED' | 'CANCELLED'
export type ParticipantType = 'HUMAN' | 'AGENT'
export type SettleReason = 'EXPIRED' | 'CANCELLED'

export interface Participant {
  userId: number
  displayName: string
  type: ParticipantType
  joinedAt: number
}

export interface AuctionResult {
  winnerId: number | null
  winnerName: string | null
  finalPrice: number
  reason: SettleReason
  settledAt: number
}

export interface Auction {
  id: number
  title: string
  description: string | null
  status: AuctionStatus
  startPrice: number
  minIncrement: number
  currentPrice: number
  currentLeaderId: number | null
  currentLeaderName: string | null
  durationSeconds: number
  startedAt: number | null
  endTime: number | null
  extendCount: number
  maxExtends: number
  seq: number
  settleReason: string | null
  createdAt: number
  participantCount: number
  participants: Participant[]
  result: AuctionResult | null
}

export interface Bid {
  id: number
  auctionId: number
  userId: number
  amount: number
  requestId: string
  seq: number
  createdAt: number
}

export interface PlaceBidRequest {
  requestId: string
  amount: number
}

export interface PlaceBidResponse {
  bidId: number
  auctionId: number
  userId: number
  amount: number
  seq: number
  idempotentReplay: boolean
  currentPrice: number
  endTime: number
  extended: boolean
  extendCount: number
  serverTime: number
}

/** 持久化事件回放（payload 为原始 JSON 字符串） */
export interface AuctionEventRecord {
  seq: number
  payload: string
}

// ---------- 管理员 ----------

export interface AdminCreateAuctionRequest {
  title: string
  description?: string
  startPrice: number
  minIncrement: number
  durationSeconds: number
}

export interface AdminCreateAuctionResponse {
  auctionId: number
}

// ---------- Agent Token ----------

export interface AgentTokenCreateRequest {
  userId: number
  auctionId: number
  scopes: string
  expiresInSeconds: number
  rateLimitPerMin: number
}

/** 明文 token 仅创建时返回一次 */
export interface AgentTokenCreated {
  tokenId: number
  token: string
  userId: number
  auctionId: number
  scopes: string
  expiresAt: number
  rateLimitPerMin: number
}

export interface AgentTokenInfo {
  tokenId: number
  tokenPrefix: string
  userId: number
  auctionId: number
  scopes: string
  expiresAt: number
  revoked: boolean
  rateLimitPerMin: number
}

// ---------- WebSocket 事件 ----------

export type WsEventType =
  | 'AUCTION_SNAPSHOT'
  | 'PARTICIPANT_JOINED'
  | 'BID_ACCEPTED'
  | 'BID_REJECTED'
  | 'AUCTION_EXTENDED'
  | 'AUCTION_FINISHED'
  | 'AUCTION_STARTED'
  | 'CONNECTION_STATE'

/** 事件信封：所有事件必含四字段 */
export interface WsEnvelope {
  type: WsEventType
  auctionId: number
  seq: number
  serverTime: number
}

export interface WsSnapshotParticipant {
  userId: number
  displayName: string
  type: ParticipantType
  joinedAt?: number
}

export interface WsSnapshot extends WsEnvelope {
  type: 'AUCTION_SNAPSHOT'
  status: AuctionStatus
  title: string
  startPrice: number
  minIncrement: number
  currentPrice: number
  currentLeaderId: number | null
  startTime: number | null
  endTime: number | null
  extendCount: number
  maxExtends: number
  settleReason: string | null
  participants: WsSnapshotParticipant[]
}

export interface WsParticipantJoined extends WsEnvelope {
  type: 'PARTICIPANT_JOINED'
  userId: number
  /**
   * 契约 §7 中 payload 写作 {userId,type}，与信封字段 type 同名冲突；
   * 运行时解析需防御处理（详见 frontend/API_QUESTIONS.md）
   */
  participantType?: ParticipantType
}

export interface WsBidAccepted extends WsEnvelope {
  type: 'BID_ACCEPTED'
  bidderId: number
  amount: number
  currentPrice: number
  leaderId: number
  endTime: number
}

/** 仅推送给本人 */
export interface WsBidRejected extends WsEnvelope {
  type: 'BID_REJECTED'
  requestId: string
  reason: string
  message: string
}

export interface WsAuctionExtended extends WsEnvelope {
  type: 'AUCTION_EXTENDED'
  fromTime: number
  toTime: number
  extendCount: number
  reason: string
}

export interface WsAuctionFinished extends WsEnvelope {
  type: 'AUCTION_FINISHED'
  reason: string
  winnerId: number | null
  finalPrice: number
}

export interface WsAuctionStarted extends WsEnvelope {
  type: 'AUCTION_STARTED'
  startTime: number
  endTime: number
  currentPrice: number
}

export interface WsConnectionState extends WsEnvelope {
  type: 'CONNECTION_STATE'
  state: 'connected' | 'rejected' | 'ping'
  reason?: string
}

export type WsMessage =
  | WsSnapshot
  | WsParticipantJoined
  | WsBidAccepted
  | WsBidRejected
  | WsAuctionExtended
  | WsAuctionFinished
  | WsAuctionStarted
  | WsConnectionState
