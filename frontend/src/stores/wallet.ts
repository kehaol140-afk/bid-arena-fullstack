import { defineStore } from 'pinia'
import { getWalletApi, getLedgerApi } from '@/api/wallet'
import type { LedgerEntry, Wallet } from '@/types'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    wallet: null as Wallet | null,
    ledger: [] as LedgerEntry[],
    loaded: false,
    loading: false,
    error: '' as string,
  }),
  getters: {
    balance: (s): number | null => s.wallet?.balance ?? null,
    frozen: (s): number | null => s.wallet?.frozen ?? null,
    available: (s): number | null => s.wallet?.available ?? null,
  },
  actions: {
    /** 轻量刷新余额（出价/被超越/结算后调用） */
    async refresh() {
      this.wallet = await getWalletApi()
      this.loaded = true
    },
    /** 拉取余额 + 流水（钱包页用）；任何失败保留既有数据并记录 error，ledger 恒为数组 */
    async refreshAll() {
      this.loading = true
      this.error = ''
      try {
        const [wallet, ledger] = await Promise.all([getWalletApi(), getLedgerApi()])
        this.wallet = wallet
        this.ledger = Array.isArray(ledger) ? ledger : []
        this.loaded = true
      } catch (e) {
        this.error = e instanceof Error && e.message ? e.message : '钱包加载失败，请稍后重试'
      } finally {
        this.loading = false
      }
    },
    clear() {
      this.wallet = null
      this.ledger = []
      this.loaded = false
      this.error = ''
    },
  },
})
