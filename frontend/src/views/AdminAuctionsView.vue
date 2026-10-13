<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createAuctionApi, startAuctionApi, cancelAuctionApi } from '@/api/admin'
import { listAuctionsApi } from '@/api/auction'
import { ApiError } from '@/api/http'
import type { Auction } from '@/types'
import { STATUS_META, formatPrice, formatDateTime } from '@/utils/format'

const auctions = ref<Auction[]>([])
const loading = ref(true)
const listError = ref('')

// ---------- 创建表单 ----------
const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const createdId = ref<number | null>(null)
const form = ref({
  title: '',
  description: '',
  startPrice: 100,
  minIncrement: 10,
  durationSeconds: 180,
})

function validateForm(): string {
  const f = form.value
  if (!f.title.trim()) return '请输入拍品标题'
  if (!Number.isInteger(f.startPrice) || f.startPrice <= 0) return '起拍价必须为正整数'
  if (!Number.isInteger(f.minIncrement) || f.minIncrement <= 0) return '最小加价必须为正整数'
  if (!Number.isInteger(f.durationSeconds) || f.durationSeconds < 3 || f.durationSeconds > 3600) {
    return '时长必须在 3 ~ 3600 秒之间'
  }
  return ''
}

async function onCreate() {
  createError.value = validateForm()
  if (createError.value) return
  creating.value = true
  try {
    const res = await createAuctionApi({
      title: form.value.title.trim(),
      description: form.value.description.trim() || undefined,
      startPrice: form.value.startPrice,
      minIncrement: form.value.minIncrement,
      durationSeconds: form.value.durationSeconds,
    })
    createdId.value = res.auctionId
    form.value = { title: '', description: '', startPrice: 100, minIncrement: 10, durationSeconds: 180 }
    await load()
  } catch (e) {
    createError.value = mapAdminError(e, '创建拍卖失败')
  } finally {
    creating.value = false
  }
}

// ---------- 启动 / 取消 ----------
const acting = ref<number | null>(null)
const actionError = ref('')
const actionSuccess = ref('')
const cancelArmed = ref<number | null>(null)
let cancelArmTimer: number | undefined

function armCancel(id: number) {
  cancelArmed.value = id
  if (cancelArmTimer != null) window.clearTimeout(cancelArmTimer)
  cancelArmTimer = window.setTimeout(() => (cancelArmed.value = null), 4000)
}

async function onStart(a: Auction) {
  acting.value = a.id
  actionError.value = ''
  try {
    const updated = await startAuctionApi(a.id)
    applyUpdated(updated)
    actionSuccess.value = `拍卖 #${a.id} 已启动，倒计时 ${updated.durationSeconds}s`
  } catch (e) {
    actionError.value = mapAdminError(e, `启动拍卖 #${a.id} 失败`)
  } finally {
    acting.value = null
  }
}

async function onCancel(a: Auction) {
  acting.value = a.id
  actionError.value = ''
  try {
    const updated = await cancelAuctionApi(a.id)
    applyUpdated(updated)
    actionSuccess.value = `拍卖 #${a.id} 已取消，全部冻结释放`
  } catch (e) {
    actionError.value = mapAdminError(e, `取消拍卖 #${a.id} 失败`)
  } finally {
    acting.value = null
    cancelArmed.value = null
  }
}

function applyUpdated(updated: Auction) {
  const idx = auctions.value.findIndex((x) => x.id === updated.id)
  if (idx >= 0) auctions.value[idx] = { ...auctions.value[idx], ...updated }
}

function mapAdminError(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return '网络异常，请重试'
  switch (e.code) {
    case 1002:
      return '无管理员权限'
    case 2007:
      return '状态迁移非法（当前状态不允许该操作）'
    case 1005:
      return '参数校验失败，请检查输入'
    default:
      return e.isNetworkError ? '网络异常，请重试' : e.message || fallback
  }
}

// ---------- 列表 ----------
async function load(silent = false) {
  if (!silent) loading.value = true
  listError.value = ''
  try {
    auctions.value = await listAuctionsApi()
  } catch {
    listError.value = '加载拍卖列表失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => load())

const sorted = computed(() => [...auctions.value].sort((a, b) => b.id - a.id))
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">拍卖管理</h1>
        <p class="page-sub">创建 → 启动（开始倒计时）→ 取消（释放全部冻结）</p>
      </div>
      <div class="head-actions">
        <RouterLink :to="{ name: 'agent-tokens' }" class="btn btn-ghost">Agent Token 管理</RouterLink>
        <button class="btn btn-primary" @click="showCreate = !showCreate">
          {{ showCreate ? '收起' : '+ 创建拍卖' }}
        </button>
      </div>
    </div>

    <div class="alert alert-info admin-flow">
      <div>
        <strong>演示流程：</strong>① 右上角「+ 创建拍卖」新建（创建后为 <strong>DRAFT 待启动</strong>，不倒计时）→
        ② 在下方列表对该场点「<strong>启动</strong>」开始倒计时，参与者即可加入出价 →
        ③ 到期<strong>自动结算</strong>（赢家扣款、其余解冻）；需要中止时点「取消」，全部冻结立即释放。
      </div>
      <div class="flow-sub">
        提示：想让拍品出现在用户端默认「仅演示拍品」列表，将描述以 <code>[DEMO]</code> 开头即可；
        Agent 自动竞拍演示请进「Agent Token 管理」签发受限 Token（操作步骤见 docs/USER_GUIDE.md）。
      </div>
    </div>

    <!-- 创建面板 -->
    <div v-if="showCreate" class="card create-card">
      <h3 class="card-title">新建拍卖（创建后为 DRAFT，不自动倒计时）</h3>
      <div v-if="createError" class="alert alert-error">{{ createError }}</div>
      <div v-if="createdId != null" class="alert alert-success">
        创建成功！拍卖编号 <RouterLink :to="{ name: 'auction-room', params: { id: createdId } }" class="mono">#{{ createdId }}</RouterLink>
        ，可在下方点击「启动」开始竞拍。
      </div>

      <form class="create-form" @submit.prevent="onCreate">
        <div class="field span-2">
          <label class="field-label">拍品标题</label>
          <input v-model="form.title" class="field-input" placeholder="如：经典机械腕表" maxlength="100" />
        </div>
        <div class="field span-2">
          <label class="field-label">描述（可选）</label>
          <input v-model="form.description" class="field-input" placeholder="拍品介绍" maxlength="500" />
        </div>
        <div class="field">
          <label class="field-label">起拍价（积分）</label>
          <input v-model.number="form.startPrice" class="field-input" type="number" min="1" step="1" />
        </div>
        <div class="field">
          <label class="field-label">最小加价（积分）</label>
          <input v-model.number="form.minIncrement" class="field-input" type="number" min="1" step="1" />
        </div>
        <div class="field">
          <label class="field-label">时长（秒，3~3600）</label>
          <input v-model.number="form.durationSeconds" class="field-input" type="number" min="3" max="3600" step="1" />
          <p class="field-hint">演示可用短时长（如 60s），默认 180s</p>
        </div>
        <div class="field create-actions">
          <button class="btn btn-primary" type="submit" :disabled="creating">
            {{ creating ? '创建中…' : '创建拍卖' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="actionError" class="alert alert-error">{{ actionError }}</div>
    <div v-if="actionSuccess" class="alert alert-success">{{ actionSuccess }}</div>
    <div v-if="listError" class="alert alert-error">{{ listError }}</div>

    <div v-if="loading" class="loading">
      <span class="spinner"></span>
      加载拍卖…
    </div>

    <div v-else class="card">
      <h3 class="card-title">全部拍卖 <span class="title-count">{{ sorted.length }} 场</span></h3>
      <div v-if="sorted.length === 0" class="empty">
        <p>暂无拍卖，点击右上角「创建拍卖」开始</p>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>编号</th>
              <th>标题</th>
              <th>状态</th>
              <th class="num">当前价</th>
              <th class="num">参与</th>
              <th>截止时间</th>
              <th>成交结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in sorted" :key="a.id">
              <td class="mono">#{{ a.id }}</td>
              <td class="cell-title">
                <RouterLink :to="{ name: 'auction-room', params: { id: a.id } }">{{ a.title }}</RouterLink>
              </td>
              <td>
                <span class="badge" :class="STATUS_META[a.status].badge">
                  <span v-if="a.status === 'RUNNING'" class="dot dot-pulse"></span>
                  {{ STATUS_META[a.status].label }}
                </span>
              </td>
              <td class="num price">{{ formatPrice(a.currentPrice) }}</td>
              <td class="num">{{ a.participantCount }}</td>
              <td class="mono dim">{{ formatDateTime(a.endTime) }}</td>
              <td class="dim result-cell">
                <template v-if="a.result">
                  {{ a.result.winnerId ? `${a.result.winnerName} @ ${formatPrice(a.result.finalPrice)}` : '无人出价' }}
                </template>
                <template v-else>--</template>
              </td>
              <td class="actions-cell">
                <button
                  v-if="a.status === 'DRAFT'"
                  class="btn btn-primary btn-sm"
                  :disabled="acting === a.id"
                  @click="onStart(a)"
                >
                  {{ acting === a.id ? '启动中…' : '启动' }}
                </button>
                <button
                  v-if="a.status === 'DRAFT' || a.status === 'RUNNING'"
                  class="btn btn-sm"
                  :class="cancelArmed === a.id ? 'btn-danger' : 'btn-ghost'"
                  :disabled="acting === a.id"
                  @click="cancelArmed === a.id ? onCancel(a) : armCancel(a.id)"
                >
                  {{ cancelArmed === a.id ? '确认取消？' : '取消' }}
                </button>
                <RouterLink :to="{ name: 'auction-room', params: { id: a.id } }" class="btn btn-ghost btn-sm">查看</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-flow {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-flow code {
  background: var(--surface-2);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
}

.flow-sub {
  font-size: 12.5px;
  opacity: 0.85;
}

.head-actions {
  display: flex;
  gap: 10px;
}

.create-card {
  margin-bottom: 16px;
}

.create-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 16px;
}

.span-2 {
  grid-column: span 2;
}

.create-actions {
  display: flex;
  align-items: flex-end;
  padding-bottom: 16px;
}

.title-count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.cell-title {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-cell {
  font-size: 12.5px;
  max-width: 160px;
}

.actions-cell {
  white-space: nowrap;
  display: flex;
  gap: 6px;
}

.dim {
  color: var(--muted);
}

@media (max-width: 900px) {
  .create-form {
    grid-template-columns: 1fr;
  }

  .span-2 {
    grid-column: span 1;
  }
}
</style>
