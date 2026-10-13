<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import { formatPrice, formatDateTime, LEDGER_META } from '@/utils/format'

const walletStore = useWalletStore()

onMounted(() => {
  walletStore.refreshAll()
})

const stats = computed(() => [
  { label: '余额（积分）', value: walletStore.balance, cls: 'stat-ink' },
  { label: '冻结中（积分）', value: walletStore.frozen, cls: 'stat-warn' },
  { label: '可用（积分）', value: walletStore.available, cls: 'stat-ok' },
])

function amountText(n: number): string {
  return n > 0 ? `+${formatPrice(n)}` : formatPrice(n)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">我的钱包</h1>
        <p class="page-sub">可用 = 余额 − 冻结；出价冻结、结算扣款/退还均实时反映</p>
      </div>
      <button class="btn btn-ghost" :disabled="walletStore.loading" @click="walletStore.refreshAll()">
        {{ walletStore.loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="walletStore.error" class="alert alert-error wallet-error">
      {{ walletStore.error }}
      <button class="btn btn-ghost btn-sm" :disabled="walletStore.loading" @click="walletStore.refreshAll()">重试</button>
    </div>

    <div class="stat-grid">
      <div v-for="s in stats" :key="s.label" class="card stat-card">
        <span class="stat-label">{{ s.label }}</span>
        <span class="stat-value price" :class="s.cls">{{ formatPrice(s.value) }}</span>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">资金流水 <span class="title-count">{{ walletStore.ledger.length }} 条</span></h3>

      <div v-if="walletStore.ledger.length === 0 && !walletStore.loading" class="empty">
        <div class="empty-icon">🧾</div>
        <p>暂无流水记录</p>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>拍卖</th>
              <th class="num">金额</th>
              <th class="num">余额后</th>
              <th class="num">冻结后</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in walletStore.ledger" :key="e.id">
              <td class="mono dim">{{ formatDateTime(e.createdAt) }}</td>
              <td>
                <span class="ledger-badge" :class="LEDGER_META[e.type]?.cls">{{ LEDGER_META[e.type]?.label ?? e.type }}</span>
              </td>
              <td class="mono">{{ e.auctionId != null ? `#${e.auctionId}` : '--' }}</td>
              <td class="num price" :class="e.amount >= 0 ? 'amt-in' : 'amt-out'">{{ amountText(e.amount) }}</td>
              <td class="num">{{ formatPrice(e.balanceAfter) }}</td>
              <td class="num">{{ formatPrice(e.frozenAfter) }}</td>
              <td class="dim remark">{{ e.remark ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wallet-error {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  font-size: 12.5px;
  color: var(--muted);
}

.stat-value {
  font-size: 28px;
}

.stat-ink {
  color: var(--ink);
}

.stat-warn {
  color: var(--warn);
}

.stat-ok {
  color: var(--success);
}

.title-count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.ledger-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
}

.ledger-freeze {
  background: var(--warn-soft);
  color: var(--warn);
}

.ledger-unfreeze {
  background: var(--info-soft);
  color: var(--info);
}

.ledger-pay {
  background: var(--danger-soft);
  color: var(--danger);
}

.ledger-refund,
.ledger-grant {
  background: var(--success-soft);
  color: var(--success);
}

.amt-in {
  color: var(--success);
}

.amt-out {
  color: var(--danger);
}

.remark {
  font-size: 12.5px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
