<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getAuctionApi, joinAuctionApi, listBidsApi, placeBidApi } from '@/api/auction'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import type { Auction, Bid, Participant, WsMessage } from '@/types'
import { STATUS_META, formatPrice, formatDateTime, newRequestId } from '@/utils/format'
import { AuctionChannel, type ChannelStatus } from '@/realtime/auctionChannel'
import Countdown from '@/components/Countdown.vue'

const props = defineProps<{
  id: string
}>()

const auth = useAuthStore()
const walletStore = useWalletStore()

const auction = ref<Auction | null>(null)
const bids = ref<Bid[]>([])
const loading = ref(true)
const loadError = ref('')

const joining = ref(false)
const joinError = ref('')

const bidAmount = ref<number | null>(null)
const submittingBid = ref(false)
const bidFeedback = ref<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

// 实时通道状态
const channelStatus = ref<ChannelStatus>('idle')
const channelNote = ref('')
let channel: AuctionChannel | null = null

let pollTimer: number | undefined
let pollTickCount = 0

// ---------- 数据加载 ----------

async function loadDetail(silent = false) {
  const id = Number(props.id)
  if (!Number.isInteger(id) || id <= 0) {
    loadError.value = '无效的拍卖编号'
    loading.value = false
    return
  }
  if (!silent) loading.value = true
  try {
    const detail = await getAuctionApi(id)
    applyDetail(detail)
  } catch (e) {
    if (!silent) {
      loadError.value =
        e instanceof ApiError && e.code === 1004 ? '拍卖不存在' : '加载拍卖详情失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

/** 详情合并（保留本地已知参与者名单的展示名） */
function applyDetail(detail: Auction) {
  const prev = auction.value
  if (prev && detail.participants.length === 0) {
    detail.participants = prev.participants
  }
  auction.value = detail
  channel?.seedSeq(detail.seq)
}

async function loadBids() {
  try {
    bids.value = await listBidsApi(Number(props.id))
  } catch {
    // 历史加载失败不打断主界面，下次轮询/事件重试
  }
}

// ---------- 轮询（WS 在线时降频为安全网） ----------

function startPolling() {
  stopPolling()
  pollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    pollTickCount += 1
    const realtime = channelStatus.value === 'connected'
    if (realtime && pollTickCount % 7 !== 0) return // 连接健康时 ~21s 兜底一次
    loadDetail(true)
    loadBids()
    if (auction.value && ['RUNNING', 'SETTLING'].includes(auction.value.status)) {
      walletStore.refresh().catch(() => {})
    }
  }, 3000)
}

function stopPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

// ---------- WebSocket 实时事件 ----------

function applyWsEvent(msg: WsMessage) {
  const a = auction.value
  if (!a || msg.auctionId !== a.id) return
  switch (msg.type) {
    case 'AUCTION_SNAPSHOT': {
      a.status = msg.status
      a.title = msg.title
      a.startPrice = msg.startPrice
      a.minIncrement = msg.minIncrement
      a.currentPrice = msg.currentPrice
      a.currentLeaderId = msg.currentLeaderId
      a.currentLeaderName = null
      a.startedAt = msg.startTime ?? a.startedAt
      a.endTime = msg.endTime ?? a.endTime
      a.extendCount = msg.extendCount
      a.maxExtends = msg.maxExtends
      a.settleReason = msg.settleReason
      if (Array.isArray(msg.participants) && msg.participants.length > 0) {
        const known = new Map(a.participants.map((p) => [p.userId, p]))
        a.participants = msg.participants.map((sp) => {
          const prev = known.get(sp.userId)
          return {
            userId: sp.userId,
            displayName: sp.displayName || prev?.displayName || `用户 #${sp.userId}`,
            type: sp.type ?? prev?.type ?? 'HUMAN',
            joinedAt: sp.joinedAt ?? prev?.joinedAt ?? msg.serverTime,
          } satisfies Participant
        })
        a.participantCount = a.participants.length
      }
      if (msg.currentLeaderId != null) {
        a.currentLeaderName = leaderNameOf(msg.currentLeaderId)
      }
      if (msg.status === 'FINISHED' || msg.status === 'CANCELLED') {
        // 结算结果（赢家名/时间）以 HTTP detail 为准，补拉一次
        loadDetail(true)
        loadBids()
        walletStore.refresh().catch(() => {})
      }
      break
    }
    case 'PARTICIPANT_JOINED': {
      if (!a.participants.some((p) => p.userId === msg.userId)) {
        a.participants = [
          ...a.participants,
          {
            userId: msg.userId,
            displayName: `用户 #${msg.userId}`,
            type: msg.participantType ?? 'HUMAN',
            joinedAt: msg.serverTime,
          },
        ]
        a.participantCount = a.participants.length
      }
      break
    }
    case 'BID_ACCEPTED': {
      const prevLeader = a.currentLeaderId
      a.currentPrice = msg.currentPrice
      a.currentLeaderId = msg.leaderId
      a.currentLeaderName = leaderNameOf(msg.leaderId)
      if (msg.endTime) a.endTime = msg.endTime
      if (!bids.value.some((b) => b.seq === msg.seq)) {
        bids.value = [
          {
            id: -msg.seq,
            auctionId: a.id,
            userId: msg.bidderId,
            amount: msg.amount,
            requestId: '',
            seq: msg.seq,
            createdAt: msg.serverTime,
          },
          ...bids.value,
        ]
      }
      if (msg.bidderId !== myUserId.value && prevLeader === myUserId.value) {
        bidFeedback.value = { kind: 'info', text: '你已被超越，冻结金额已释放，可继续出价' }
      }
      if (msg.bidderId === myUserId.value || prevLeader === myUserId.value) {
        walletStore.refresh().catch(() => {})
      }
      break
    }
    case 'BID_REJECTED': {
      bidFeedback.value = { kind: 'error', text: `出价被拒绝：${msg.message || msg.reason}` }
      break
    }
    case 'AUCTION_EXTENDED': {
      a.endTime = msg.toTime
      a.extendCount = msg.extendCount
      bidFeedback.value = {
        kind: 'info',
        text: `最后时刻出价，延时 +${Math.round((msg.toTime - msg.fromTime) / 1000)}s（第 ${msg.extendCount}/${a.maxExtends} 次）`,
      }
      break
    }
    case 'AUCTION_FINISHED': {
      a.status = 'FINISHED'
      a.settleReason = msg.reason
      if (!a.result || a.result.winnerId !== msg.winnerId || a.result.finalPrice !== msg.finalPrice) {
        a.result = {
          winnerId: msg.winnerId,
          winnerName: msg.winnerId != null ? leaderNameOf(msg.winnerId) : null,
          finalPrice: msg.finalPrice,
          reason: msg.reason === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED',
          settledAt: msg.serverTime,
        }
      }
      loadDetail(true)
      loadBids()
      walletStore.refresh().catch(() => {})
      break
    }
    case 'AUCTION_STARTED': {
      a.status = 'RUNNING'
      a.startedAt = msg.startTime
      a.endTime = msg.endTime
      a.currentPrice = msg.currentPrice
      bidFeedback.value = { kind: 'info', text: '拍卖已开始，可以加入并出价了' }
      break
    }
    case 'CONNECTION_STATE': {
      if (msg.state === 'rejected') channelNote.value = msg.reason || '连接被服务端拒绝'
      break
    }
  }
}

function leaderNameOf(userId: number): string {
  if (userId === myUserId.value) return auth.displayName
  const p = auction.value?.participants.find((x) => x.userId === userId)
  return p?.displayName || `用户 #${userId}`
}

// ---------- 生命周期 ----------

onMounted(async () => {
  await loadDetail()
  loadBids()
  walletStore.refresh().catch(() => {})

  const a = auction.value
  if (a && auth.token && !['FINISHED', 'CANCELLED'].includes(a.status)) {
    channel = new AuctionChannel(a.id, auth.token, {
      onEvent: applyWsEvent,
      onStatus: (s, detail) => {
        channelStatus.value = s
        if (detail) channelNote.value = detail
      },
    })
    channel.seedSeq(a.seq)
    channel.connect()
  }
  startPolling()
})

onBeforeUnmount(() => {
  channel?.close()
  channel = null
  stopPolling()
})

// ---------- 状态派生 ----------

const statusMeta = computed(() => (auction.value ? STATUS_META[auction.value.status] : null))
const isRunning = computed(() => auction.value?.status === 'RUNNING')
const myUserId = computed(() => auth.user?.id ?? null)
const isJoined = computed(() => !!auction.value?.participants.some((p) => p.userId === myUserId.value))
const hasBid = computed(() => auction.value?.currentLeaderId != null)
const isLeader = computed(() => auction.value?.currentLeaderId === myUserId.value)

/** 最小合法出价：无人出价 = 起拍价 + 最小加价；有人出价 = 当前价 + 最小加价（R3.2 首价 ≥ 110 语义） */
const minNextBid = computed(() => {
  if (!auction.value) return 0
  return auction.value.currentPrice + auction.value.minIncrement
})

const quickSteps = [1, 5, 20]

// 价格上移后，若输入框低于新最低价则自动顶到最低价
watch(minNextBid, (mn) => {
  if (bidAmount.value == null || bidAmount.value < mn) bidAmount.value = mn
})

const channelBadge = computed(() => {
  switch (channelStatus.value) {
    case 'connected':
      return { text: '实时', cls: 'ch-live' }
    case 'connecting':
      return { text: '连接中', cls: 'ch-wait' }
    case 'reconnecting':
      return { text: '重连中', cls: 'ch-wait' }
    case 'rejected':
      return { text: '实时被拒', cls: 'ch-off' }
    case 'closed':
      return { text: '离线', cls: 'ch-off' }
    default:
      return { text: '离线', cls: 'ch-off' }
  }
})

function quickBid(multiplier: number) {
  const base = bidAmount.value ?? minNextBid.value
  bidAmount.value = base + auction.value!.minIncrement * multiplier
  bidFeedback.value = null
}

function resetToMin() {
  bidAmount.value = minNextBid.value
}

// ---------- 加入拍卖 ----------

async function onJoin() {
  joining.value = true
  joinError.value = ''
  try {
    await joinAuctionApi(Number(props.id))
    await loadDetail(true)
  } catch (e) {
    joinError.value =
      e instanceof ApiError
        ? e.code === 2001
          ? '当前状态不可加入（仅竞拍中可加入）'
          : e.message || '加入失败'
        : '网络异常，加入失败'
  } finally {
    joining.value = false
  }
}

// ---------- 出价 ----------

function mapBidError(e: unknown): string {
  if (!(e instanceof ApiError)) return '网络异常，出价失败，请重试'
  switch (e.code) {
    case 2001:
      return '拍卖当前不可出价（非竞拍中状态）'
    case 2002:
      return `出价低于最小合法价 ${formatPrice(minNextBid.value)} 积分`
    case 2003:
      return `可用余额不足（当前可用 ${formatPrice(walletStore.available ?? 0)} 积分）`
    case 2004:
      return '出价迟到：拍卖已到截止时间'
    case 2005:
      return '请求号冲突，请重新出价'
    case 1005:
      return '参数不合法，请检查出价金额'
    default:
      return e.isNetworkError ? '网络异常，出价失败，请重试' : e.message || '出价失败'
  }
}

async function onBid() {
  if (!auction.value || !isRunning.value) return
  const amount = Number(bidAmount.value)
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    bidFeedback.value = { kind: 'error', text: '出价必须为整数积分' }
    return
  }
  if (amount < minNextBid.value) {
    bidFeedback.value = { kind: 'error', text: `出价不能低于 ${formatPrice(minNextBid.value)} 积分` }
    return
  }
  submittingBid.value = true
  bidFeedback.value = null
  try {
    const res = await placeBidApi(auction.value.id, { requestId: newRequestId(), amount })
    // 用服务端权威数据更新本地状态
    auction.value.currentPrice = res.currentPrice
    auction.value.endTime = res.endTime
    auction.value.extendCount = res.extendCount
    auction.value.currentLeaderId = myUserId.value
    auction.value.currentLeaderName = auth.displayName
    auction.value.seq = res.seq
    channel?.seedSeq(res.seq)
    if (!res.idempotentReplay && !bids.value.some((b) => b.id === res.bidId || b.seq === res.seq)) {
      bids.value = [
        {
          id: res.bidId,
          auctionId: res.auctionId,
          userId: res.userId,
          amount: res.amount,
          requestId: '',
          seq: res.seq,
          createdAt: res.serverTime,
        },
        ...bids.value,
      ]
    }
    if (res.idempotentReplay) {
      bidFeedback.value = { kind: 'info', text: '该请求已处理过（幂等重放），未产生新出价' }
    } else if (res.extended) {
      bidFeedback.value = {
        kind: 'success',
        text: `出价成功！触发最后时刻延时 +10s（第 ${res.extendCount}/${auction.value.maxExtends} 次）`,
      }
    } else {
      bidFeedback.value = { kind: 'success', text: `出价成功，当前最高价 ${formatPrice(res.currentPrice)} 积分` }
    }
    resetToMin()
    walletStore.refresh().catch(() => {})
  } catch (e) {
    bidFeedback.value = { kind: 'error', text: mapBidError(e) }
    // 状态可能已变化，静默刷新
    loadDetail(true)
    walletStore.refresh().catch(() => {})
  } finally {
    submittingBid.value = false
  }
}

/** 倒计时归零：等待服务端结算（SETTLING → FINISHED 由 WS/轮询兜底） */
function onCountdownEnded() {
  loadDetail(true)
  loadBids()
}

function goBack() {
  if (window.history.length > 1) window.history.back()
}
</script>

<template>
  <div>
    <div v-if="loading" class="loading">
      <span class="spinner"></span>
      加载拍卖详情…
    </div>

    <div v-else-if="loadError" class="empty card">
      <div class="empty-icon">❓</div>
      <p>{{ loadError }}</p>
      <button class="btn btn-ghost" @click="goBack">返回列表</button>
    </div>

    <template v-else-if="auction">
      <div class="room-head">
        <div>
          <RouterLink :to="{ name: 'auction-list' }" class="back-link">← 拍卖列表</RouterLink>
          <h1 class="page-title room-title">
            {{ auction.title }}
            <span class="badge" :class="statusMeta?.badge">
              <span v-if="isRunning" class="dot dot-pulse"></span>
              {{ statusMeta?.label }}
            </span>
            <span
              class="channel-badge mono"
              :class="channelBadge.cls"
              :title="channelNote || 'WebSocket 实时通道状态'"
            >
              <span class="dot"></span>{{ channelBadge.text }}
            </span>
          </h1>
          <p class="page-sub mono">#{{ auction.id }} · 创建于 {{ formatDateTime(auction.createdAt) }}</p>
        </div>
      </div>

      <!-- 成交/取消 结果横幅 -->
      <div
        v-if="auction.status === 'FINISHED' && auction.result"
        class="alert result-banner"
        :class="auction.result.winnerId ? 'alert-success' : 'alert-info'"
      >
        <div class="result-main">
          <template v-if="auction.result.winnerId">
            🎉 拍卖成交 · 得主 <strong>{{ auction.result.winnerName }}</strong>
            ，成交价 <strong class="price">{{ formatPrice(auction.result.finalPrice) }}</strong> 积分
          </template>
          <template v-else>拍卖已结束（无人出价，不产生扣款）</template>
          <span class="result-sub">结算时间 {{ formatDateTime(auction.result.settledAt) }}</span>
        </div>
      </div>
      <div v-else-if="auction.status === 'CANCELLED'" class="alert alert-error result-banner">
        <div class="result-main">
          ⛔ 管理员已取消本场拍卖，全部冻结已释放
          <span v-if="auction.result" class="result-sub">取消时间 {{ formatDateTime(auction.result.settledAt) }}</span>
        </div>
      </div>

      <div class="room-grid">
        <!-- 主列 -->
        <div class="room-main">
          <!-- 实时状态卡 -->
          <div class="card status-card">
            <div class="status-grid">
              <div class="status-cell">
                <span class="ac-label">{{ hasBid ? '当前最高价' : '起拍价' }}</span>
                <span class="price price-gold price-large">{{ formatPrice(auction.currentPrice) }}</span>
                <span class="unit">积分</span>
              </div>
              <div class="status-cell">
                <span class="ac-label">领先者</span>
                <span class="leader-name">
                  <template v-if="hasBid">
                    {{ auction.currentLeaderName || `用户 #${auction.currentLeaderId}` }}
                    <span v-if="isLeader" class="you-tag">（你）</span>
                  </template>
                  <template v-else>暂无出价</template>
                </span>
              </div>
              <div class="status-cell">
                <span class="ac-label">{{ isRunning ? '距截止' : auction.endTime ? '已截止' : '未启动' }}</span>
                <Countdown v-if="auction.endTime" :end-time="auction.endTime" @ended="onCountdownEnded" />
                <span v-else class="mono dim">--:--</span>
              </div>
              <div class="status-cell">
                <span class="ac-label">延时</span>
                <span class="mono">{{ auction.extendCount }}/{{ auction.maxExtends }}</span>
              </div>
            </div>
            <div v-if="hasBid && isLeader" class="leader-note">你目前是最高出价人，冻结金额将在结算时扣除或退还</div>
          </div>

          <!-- 出价面板 -->
          <div class="card bid-panel">
            <h3 class="card-title">出价</h3>

            <template v-if="!auth.isAuthenticated">
              <p class="dim">请先登录后参与竞价</p>
            </template>

            <template v-else-if="auction.status === 'DRAFT'">
              <p class="dim">拍卖尚未启动，等待管理员开始后即可加入竞价。</p>
            </template>

            <template v-else-if="isRunning && !isJoined">
              <p class="dim">加入本场拍卖后方可出价（仅竞拍中可加入，重复加入幂等）。</p>
              <div v-if="joinError" class="alert alert-error">{{ joinError }}</div>
              <button class="btn btn-gold btn-lg" :disabled="joining" @click="onJoin">
                {{ joining ? '加入中…' : '加入本场竞拍' }}
              </button>
            </template>

            <template v-else-if="isRunning && isJoined">
              <div
                v-if="bidFeedback"
                class="alert"
                :class="`alert-${bidFeedback.kind === 'error' ? 'error' : bidFeedback.kind === 'success' ? 'success' : 'info'}`"
              >
                {{ bidFeedback.text }}
              </div>

              <div class="bid-min-row">
                <span>最低可出价：<strong class="price">{{ formatPrice(minNextBid) }}</strong> 积分（当前价 + 最小加价 {{ auction.minIncrement }}）</span>
              </div>

              <div class="bid-input-row">
                <input
                  v-model.number="bidAmount"
                  class="field-input bid-amount"
                  type="number"
                  :min="minNextBid"
                  :step="auction.minIncrement"
                  placeholder="出价金额"
                  :disabled="submittingBid"
                  @keyup.enter="onBid"
                  @focus="bidFeedback = null"
                />
                <span class="unit">积分</span>
                <button class="btn btn-gold btn-lg" :disabled="submittingBid || bidAmount == null" @click="onBid">
                  {{ submittingBid ? '提交中…' : '确认出价' }}
                </button>
              </div>

              <div class="quick-row">
                <button class="btn btn-ghost btn-sm" @click="resetToMin">最低价</button>
                <button
                  v-for="m in quickSteps"
                  :key="m"
                  class="btn btn-ghost btn-sm"
                  :disabled="submittingBid"
                  @click="quickBid(m)"
                >
                  +{{ auction.minIncrement * m }}
                </button>
                <span class="quick-hint">最后 5 秒内的出价将触发延时 +10s（最多 {{ auction.maxExtends }} 次）</span>
              </div>
            </template>

            <template v-else-if="auction.status === 'SETTLING'">
              <p class="dim">拍卖已到时，服务端正在结算，请稍候…</p>
            </template>

            <template v-else>
              <p class="dim">拍卖已结束，无法再出价。</p>
            </template>
          </div>

          <!-- 出价历史 -->
          <div class="card">
            <h3 class="card-title">出价历史 <span class="title-count">{{ bids.length }} 条</span></h3>
            <div v-if="bids.length === 0" class="empty small-empty">
              <p>暂无出价记录</p>
            </div>
            <div v-else class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>出价人</th>
                    <th class="num">金额</th>
                    <th class="num">事件号</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in bids" :key="`${b.seq}-${b.id}`" :class="{ mine: b.userId === myUserId }">
                    <td class="mono dim">{{ formatDateTime(b.createdAt) }}</td>
                    <td>
                      {{ leaderNameOf(b.userId) }}
                      <span v-if="b.userId === myUserId" class="you-tag">（你）</span>
                    </td>
                    <td class="num price">{{ formatPrice(b.amount) }}</td>
                    <td class="num mono dim">{{ b.seq }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 侧栏 -->
        <div class="room-side">
          <div class="card">
            <h3 class="card-title">我的钱包</h3>
            <template v-if="walletStore.wallet">
              <div class="wallet-mini">
                <div>
                  <span class="ac-label">可用</span>
                  <span class="price">{{ formatPrice(walletStore.available) }}</span>
                </div>
                <div>
                  <span class="ac-label">冻结中</span>
                  <span class="price frozen-num">{{ formatPrice(walletStore.frozen) }}</span>
                </div>
              </div>
              <RouterLink :to="{ name: 'wallet' }" class="side-link">查看钱包与流水 →</RouterLink>
            </template>
            <p v-else class="dim">未能加载钱包信息</p>
          </div>

          <div class="card">
            <h3 class="card-title">
              参与者
              <span class="title-count">{{ auction.participants.length || auction.participantCount }}</span>
            </h3>
            <div v-if="(auction.participants.length || 0) === 0" class="empty small-empty">
              <p>暂无参与者</p>
            </div>
            <ul v-else class="participant-list">
              <li v-for="p in auction.participants" :key="p.userId" :class="{ mine: p.userId === myUserId }">
                <span class="p-name">
                  {{ p.displayName }}
                  <span v-if="p.userId === myUserId" class="you-tag">（你）</span>
                </span>
                <span class="badge" :class="p.type === 'AGENT' ? 'badge-settling' : 'badge-draft'">
                  {{ p.type === 'AGENT' ? 'AGENT' : '用户' }}
                </span>
              </li>
            </ul>
          </div>

          <div class="card">
            <h3 class="card-title">拍卖信息</h3>
            <dl class="info-list">
              <div><dt>起拍价</dt><dd>{{ formatPrice(auction.startPrice) }} 积分</dd></div>
              <div><dt>最小加价</dt><dd>{{ auction.minIncrement }} 积分</dd></div>
              <div><dt>时长</dt><dd>{{ auction.durationSeconds }} 秒</dd></div>
              <div><dt>开始时间</dt><dd>{{ formatDateTime(auction.startedAt) }}</dd></div>
              <div><dt>截止时间</dt><dd>{{ formatDateTime(auction.endTime) }}</dd></div>
              <div><dt>事件序号</dt><dd class="mono">{{ auction.seq }}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.room-head {
  margin-bottom: 18px;
}

.back-link {
  font-size: 13px;
  display: inline-block;
  margin-bottom: 6px;
  color: var(--muted);
}

.back-link:hover {
  color: var(--primary);
}

.room-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.ch-live {
  color: var(--success);
  background: var(--success-soft);
}

.ch-live .dot {
  animation: dot-pulse 1.6s ease-in-out infinite;
}

.ch-wait {
  color: var(--warn);
  background: var(--warn-soft);
}

.ch-wait .dot {
  animation: dot-pulse 0.8s ease-in-out infinite;
}

.ch-off {
  color: var(--muted);
  background: var(--surface-2);
}

.result-banner {
  font-size: 15px;
}

.result-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-sub {
  font-size: 12px;
  opacity: 0.8;
}

.room-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.room-main,
.room-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.status-card {
  background: linear-gradient(180deg, #fff, #fbfaf7);
}

.status-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 0.7fr;
  gap: 14px;
  align-items: center;
}

.status-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ac-label {
  font-size: 11.5px;
  color: var(--muted);
}

.leader-name {
  font-weight: 700;
  font-size: 17px;
}

.unit {
  font-size: 12px;
  color: var(--muted);
}

.leader-note {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--gold);
  background: var(--gold-soft);
  border-radius: 8px;
  padding: 7px 10px;
}

.bid-min-row {
  font-size: 13px;
  color: var(--ink-2);
  margin-bottom: 12px;
}

.bid-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bid-amount {
  max-width: 220px;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.quick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.quick-hint {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
}

.title-count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

tr.mine td {
  background: #fdf8ec;
}

.you-tag {
  color: var(--gold);
  font-size: 12px;
  font-weight: 700;
}

.small-empty {
  padding: 20px;
}

.wallet-mini {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.wallet-mini > div {
  background: var(--surface-2);
  border-radius: 9px;
  padding: 10px 12px;
}

.frozen-num {
  color: var(--warn);
}

.side-link {
  font-size: 13px;
}

.participant-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.participant-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line);
}

.participant-list li:last-child {
  border-bottom: none;
}

.participant-list li.mine .p-name {
  font-weight: 700;
}

.info-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-list > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.info-list dt {
  color: var(--muted);
}

.info-list dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.dim {
  color: var(--muted);
}

@media (max-width: 900px) {
  .room-grid {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
