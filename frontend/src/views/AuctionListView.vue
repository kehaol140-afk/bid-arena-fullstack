<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listAuctionsApi } from '@/api/auction'
import type { Auction, AuctionStatus } from '@/types'
import AuctionCard from '@/components/AuctionCard.vue'
import { isDemoAuction } from '@/utils/demoAuctions'

type Filter = 'ALL' | AuctionStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'RUNNING', label: '竞拍中' },
  { key: 'DRAFT', label: '待启动' },
  { key: 'FINISHED', label: '已成交' },
  { key: 'CANCELLED', label: '已取消' },
]

const auctions = ref<Auction[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<Filter>('ALL')
const demoOnly = ref(true)

let timer: number | undefined

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    auctions.value = await listAuctionsApi()
  } catch {
    error.value = '加载拍卖列表失败，请确认后端服务已启动'
  } finally {
    loading.value = false
  }
}

function startPolling() {
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') load(true)
  }, 8000)
}

onMounted(() => {
  load()
  startPolling()
})

onBeforeUnmount(() => {
  if (timer != null) window.clearInterval(timer)
})

const filtered = computed(() => {
  const visible=demoOnly.value ? auctions.value.filter(isDemoAuction) : auctions.value
  if (filter.value === 'ALL') return visible
  return visible.filter((a) => a.status === filter.value)
})

const countOf = (key: Filter) =>
  auctions.value.filter(a => (!demoOnly.value || isDemoAuction(a)) && (key === 'ALL' || a.status === key)).length
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">拍卖大厅</h1>
        <p class="page-sub">实时竞价 · 服务端权威计价 · 毫秒级倒计时</p>
      </div>
      <div><label><input v-model="demoOnly" type="checkbox" /> 仅演示拍品</label>
      <button class="btn btn-ghost" :disabled="loading" @click="load()">刷新</button></div>
    </div>

    <div class="filter-tabs">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        class="filter-tab"
        :class="{ active: filter === f.key }"
        @click="filter = f.key"
      >
        {{ f.label }}
        <span class="filter-count">{{ countOf(f.key) }}</span>
      </button>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading" class="loading">
      <span class="spinner"></span>
      加载拍卖列表…
    </div>

    <div v-else-if="filtered.length === 0" class="empty card">
      <div class="empty-icon">🔨</div>
      <p v-if="auctions.length === 0">暂无拍卖。请等待管理员创建并启动拍卖。</p>
      <p v-else>该分类下暂无拍卖</p>
    </div>

    <div v-else class="auction-grid">
      <AuctionCard v-for="a in filtered" :key="a.id" :auction="a" />
    </div>
  </div>
</template>

<style scoped>
.filter-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.filter-tab {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.filter-tab:hover {
  border-color: var(--line-strong);
  background: var(--surface-2);
}

.filter-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.filter-count {
  font-size: 11.5px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.auction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
</style>
