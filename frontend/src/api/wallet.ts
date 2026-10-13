import { ApiError, request } from './http'
import type { LedgerEntry, Wallet } from '@/types'

export function getWalletApi(): Promise<Wallet> {
  return request<Wallet>({ method: 'get', url: '/api/v1/wallets/me' })
}

/**
 * 资金流水：成功时必须是数组。
 * code=0 但 data 缺失/null（历史后端空流水形态）按空数组兼容；
 * data 为其他非数组类型视为契约异常抛出，绝不当作空流水掩盖。
 */
export async function getLedgerApi(): Promise<LedgerEntry[]> {
  const data = await request<LedgerEntry[] | null>({ method: 'get', url: '/api/v1/wallets/me/ledger' })
  if (data == null) return []
  if (!Array.isArray(data)) {
    throw new ApiError(9999, '流水响应格式异常', 200)
  }
  return data
}
