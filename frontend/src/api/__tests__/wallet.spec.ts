import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../http', () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly code: number
    readonly status: number
    constructor(code: number, message: string, status: number) {
      super(message)
      this.code = code
      this.status = status
    }
  },
}))

import { request } from '../http'
import { getLedgerApi } from '../wallet'

const rows = [
  {
    id: 1,
    auctionId: 1,
    requestId: null,
    type: 'FREEZE' as const,
    amount: -110,
    balanceAfter: 1000,
    frozenAfter: 110,
    remark: null,
    createdAt: 1791800000000,
  },
]

describe('getLedgerApi 响应契约', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  it('T3 正常数组原样返回', async () => {
    vi.mocked(request).mockResolvedValueOnce(rows)
    await expect(getLedgerApi()).resolves.toEqual(rows)
  })

  it('T3 空数组 [] 原样返回', async () => {
    vi.mocked(request).mockResolvedValueOnce([])
    await expect(getLedgerApi()).resolves.toEqual([])
  })

  it('T4 data 为 null/undefined（历史空流水形态）兼容为 []', async () => {
    vi.mocked(request).mockResolvedValueOnce(null)
    await expect(getLedgerApi()).resolves.toEqual([])
    vi.mocked(request).mockResolvedValueOnce(undefined)
    await expect(getLedgerApi()).resolves.toEqual([])
  })

  it('T5 data 为非数组对象时抛契约异常，不得当作空流水', async () => {
    vi.mocked(request).mockResolvedValueOnce({ unexpected: true } as never)
    await expect(getLedgerApi()).rejects.toMatchObject({ code: 9999 })
  })

  it('T5 request 抛出（HTTP 403/500 等）时原样传播，不吞错', async () => {
    const err = Object.assign(new Error('Forbidden'), { code: 1002, status: 403 })
    vi.mocked(request).mockRejectedValueOnce(err)
    await expect(getLedgerApi()).rejects.toBe(err)
  })
})
