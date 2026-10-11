import { request } from './http'
import type { LedgerEntry, Wallet } from '@/types'

export function getWalletApi(): Promise<Wallet> {
  return request<Wallet>({ method: 'get', url: '/api/v1/wallets/me' })
}

export function getLedgerApi(): Promise<LedgerEntry[]> {
  return request<LedgerEntry[]>({ method: 'get', url: '/api/v1/wallets/me/ledger' })
}
