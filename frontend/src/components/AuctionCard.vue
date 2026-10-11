<script setup lang="ts">
import { computed } from 'vue'
import type { Auction } from '@/types'
import { STATUS_META, formatPrice, formatDateTime } from '@/utils/format'
import Countdown from './Countdown.vue'

const props = defineProps<{
  auction: Auction
}>()

const meta = computed(() => STATUS_META[props.auction.status])
const isRunning = computed(() => props.auction.status === 'RUNNING')
const hasBid = computed(() => props.auction.currentLeaderId != null)
</script>

<template>
  <RouterLink :to="{ name: 'auction-room', params: { id: auction.id } }" class="auction-card">
    <div class="ac-head">
      <span class="badge" :class="meta.badge">
        <span v-if="isRunning" class="dot dot-pulse"></span>
        {{ meta.label }}
      </span>
      <span class="ac-id mono">#{{ auction.id }}</span>
    </div>

    <h3 class="ac-title">{{ auction.title }}</h3>
    <p class="ac-desc">{{ auction.description || '暂无描述' }}</p>

    <div class="ac-price-row">
      <div class="ac-price-block">
        <span class="ac-label">{{ hasBid ? '当前最高价' : '起拍价' }}</span>
        <span class="price price-gold">{{ formatPrice(auction.currentPrice) }}</span>
        <span class="ac-unit">积分</span>
      </div>
      <div v-if="isRunning" class="ac-countdown">
        <span class="ac-label">剩余时间</span>
        <Countdown :end-time="auction.endTime" />
      </div>
    </div>

    <div class="ac-meta">
      <span>{{ hasBid ? `领先者 · ${auction.currentLeaderName}` : '暂无出价' }}</span>
      <span>{{ auction.participantCount }} 人参与</span>
      <span>最小加价 {{ auction.minIncrement }}</span>
    </div>

    <div v-if="auction.status === 'FINISHED' && auction.result" class="ac-result">
      成交 · {{ auction.result.winnerName ?? '无人出价' }} @ {{ formatPrice(auction.result.finalPrice) }}
    </div>
    <div v-else-if="auction.status === 'CANCELLED'" class="ac-result cancelled">已取消，冻结已全额释放</div>
    <div v-else-if="auction.status === 'DRAFT'" class="ac-result draft">等待管理员启动 · 时长 {{ auction.durationSeconds }}s</div>
    <div v-else-if="auction.startedAt" class="ac-time">开始于 {{ formatDateTime(auction.startedAt) }}</div>
  </RouterLink>
</template>

<style scoped>
.auction-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 18px 20px 16px;
  color: var(--ink);
  transition: transform 0.12s, box-shadow 0.15s, border-color 0.15s;
}

.auction-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--line-strong);
}

.ac-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ac-id {
  font-size: 12px;
  color: var(--muted);
}

.ac-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ac-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.6em;
}

.ac-price-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  padding-top: 4px;
}

.ac-label {
  display: block;
  font-size: 11.5px;
  color: var(--muted);
  margin-bottom: 2px;
}

.ac-price-block .price {
  font-size: 26px;
}

.ac-unit {
  font-size: 12px;
  color: var(--muted);
  margin-left: 4px;
}

.ac-countdown {
  text-align: right;
}

.ac-countdown .countdown {
  font-size: 19px;
}

.ac-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--ink-2);
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.ac-result {
  font-size: 13px;
  font-weight: 600;
  color: var(--info);
  background: var(--info-soft);
  border-radius: 8px;
  padding: 7px 10px;
}

.ac-result.cancelled {
  color: var(--danger);
  background: var(--danger-soft);
}

.ac-result.draft {
  color: var(--muted);
  background: var(--surface-2);
}

.ac-time {
  font-size: 12px;
  color: var(--muted);
}
</style>
