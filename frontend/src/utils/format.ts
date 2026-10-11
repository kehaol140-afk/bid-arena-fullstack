import type { AuctionStatus, LedgerType } from '@/types'

export function formatPrice(n: number | null | undefined): string {
  if (n == null) return '--'
  return n.toLocaleString('zh-CN')
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '--'
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 剩余毫秒 → mm:ss 或 h:mm:ss */
export function formatClock(remainMs: number): string {
  if (remainMs <= 0) return '00:00'
  const total = Math.floor(remainMs / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 出价幂等键（UUID v4，降级到随机拼接） */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const STATUS_META: Record<AuctionStatus, { label: string; badge: string }> = {
  DRAFT: { label: '待启动', badge: 'badge-draft' },
  RUNNING: { label: '竞拍中', badge: 'badge-running' },
  SETTLING: { label: '结算中', badge: 'badge-settling' },
  FINISHED: { label: '已成交', badge: 'badge-finished' },
  CANCELLED: { label: '已取消', badge: 'badge-cancelled' },
}

export const LEDGER_META: Record<LedgerType, { label: string; cls: string }> = {
  FREEZE: { label: '冻结', cls: 'ledger-freeze' },
  UNFREEZE: { label: '解冻', cls: 'ledger-unfreeze' },
  PAY: { label: '扣款', cls: 'ledger-pay' },
  REFUND: { label: '退款', cls: 'ledger-refund' },
  GRANT: { label: '入账', cls: 'ledger-grant' },
}
