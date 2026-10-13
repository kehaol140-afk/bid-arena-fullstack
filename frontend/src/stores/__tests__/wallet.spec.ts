import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWalletStore } from '../wallet'

vi.mock('@/api/wallet', () => ({
  getWalletApi: vi.fn(),
  getLedgerApi: vi.fn(),
}))

import { getWalletApi, getLedgerApi } from '@/api/wallet'
import type { LedgerEntry } from '@/types'

const ADMIN_WALLET = { userId: 1, balance: 1000, frozen: 0, available: 1000 }

function entry(partial: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 1,
    auctionId: 1,
    requestId: null,
    type: 'FREEZE',
    amount: -110,
    balanceAfter: 1000,
    frozenAfter: 110,
    remark: null,
    createdAt: 1791800000000,
    ...partial,
  }
}

describe('wallet store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getWalletApi).mockReset()
    vi.mocked(getLedgerApi).mockReset()
  })

  it('T1 管理员零流水：钱包1000/冻结0，ledger 为 [] 且不出现 undefined', async () => {
    vi.mocked(getWalletApi).mockResolvedValueOnce(ADMIN_WALLET)
    vi.mocked(getLedgerApi).mockResolvedValueOnce([])
    const w = useWalletStore()

    await w.refreshAll()

    expect(w.balance).toBe(1000)
    expect(w.frozen).toBe(0)
    expect(w.available).toBe(1000)
    expect(Array.isArray(w.ledger)).toBe(true)
    expect(w.ledger.length).toBe(0)
    expect(w.error).toBe('')
    expect(w.loaded).toBe(true)
  })

  it('T2 普通用户 FREEZE/PAY 流水原样保留', async () => {
    const rows = [
      entry({ id: 2, type: 'PAY', amount: -170, frozenAfter: 0, remark: 'win auction 9' }),
      entry({ id: 1, type: 'FREEZE', amount: -110 }),
    ]
    vi.mocked(getWalletApi).mockResolvedValueOnce({ userId: 2, balance: 830, frozen: 0, available: 830 })
    vi.mocked(getLedgerApi).mockResolvedValueOnce(rows)
    const w = useWalletStore()

    await w.refreshAll()

    expect(w.ledger).toHaveLength(2)
    expect(w.ledger[0].type).toBe('PAY')
    expect(w.ledger[1].type).toBe('FREEZE')
  })

  it('T4 兼容：API 层把 null 规范为 []（store 不接受非数组覆盖）', async () => {
    vi.mocked(getWalletApi).mockResolvedValue(ADMIN_WALLET)
    vi.mocked(getLedgerApi).mockResolvedValueOnce([])
    const w = useWalletStore()
    await w.refreshAll()
    expect(w.ledger).toEqual([])
    // 防御：即使未来 API 层退化为返回 undefined，store 也保持数组
    w.ledger = undefined as unknown as LedgerEntry[]
    await w.refreshAll()
    expect(Array.isArray(w.ledger)).toBe(true)
  })

  it('T5 API 异常：记录 error、保留既有数据、ledger 仍为数组（不白屏）', async () => {
    vi.mocked(getWalletApi).mockResolvedValue(ADMIN_WALLET)
    vi.mocked(getLedgerApi).mockResolvedValueOnce([entry()])
    const w = useWalletStore()
    await w.refreshAll()
    expect(w.ledger).toHaveLength(1)

    vi.mocked(getLedgerApi).mockRejectedValueOnce(
      Object.assign(new Error('网络异常，无法连接服务器'), { code: 9999, status: 0 }),
    )
    await w.refreshAll()

    expect(w.error).toBe('网络异常，无法连接服务器')
    expect(Array.isArray(w.ledger)).toBe(true)
    expect(w.ledger).toHaveLength(1)
    expect(w.loading).toBe(false)
  })

  it('T6 clear 后状态归零，可再次 refreshAll 恢复', async () => {
    vi.mocked(getWalletApi).mockResolvedValue(ADMIN_WALLET)
    vi.mocked(getLedgerApi).mockResolvedValue([entry()])
    const w = useWalletStore()
    await w.refreshAll()
    w.clear()
    expect(w.wallet).toBeNull()
    expect(w.ledger).toEqual([])
    expect(w.error).toBe('')

    await w.refreshAll()
    expect(w.balance).toBe(1000)
    expect(w.ledger).toHaveLength(1)
  })
})
