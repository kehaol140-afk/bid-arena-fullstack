<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createAgentTokenApi, listAgentTokensApi, revokeAgentTokenApi } from '@/api/admin'
import { listAuctionsApi } from '@/api/auction'
import { ApiError } from '@/api/http'
import type { AgentTokenCreated, AgentTokenInfo, Auction } from '@/types'
import { formatDateTime } from '@/utils/format'

const tokens = ref<AgentTokenInfo[]>([])
const auctions = ref<Auction[]>([])
const loading = ref(true)
const listError = ref('')

const filterUserId = ref<number | null>(null)

// ---------- 创建表单 ----------
const creating = ref(false)
const createError = ref('')
const created = ref<AgentTokenCreated | null>(null)
const copied = ref(false)
const form = ref({
  userId: 2,
  auctionId: 1,
  scopeRead: true,
  scopeBid: true,
  expiresInSeconds: 3600,
  rateLimitPerMin: 30,
})

function validateForm(): string {
  const f = form.value
  if (!Number.isInteger(f.userId) || f.userId <= 0) return '用户 ID 必须为正整数'
  if (!Number.isInteger(f.auctionId) || f.auctionId <= 0) return '拍卖 ID 必须为正整数'
  if (!f.scopeRead && !f.scopeBid) return '至少选择一个权限（read / bid）'
  if (!Number.isInteger(f.expiresInSeconds) || f.expiresInSeconds <= 0) return '有效期必须为正整数秒'
  if (!Number.isInteger(f.rateLimitPerMin) || f.rateLimitPerMin <= 0) return '频率限制必须为正整数'
  return ''
}

async function onCreate() {
  createError.value = validateForm()
  if (createError.value) return
  creating.value = true
  created.value = null
  copied.value = false
  try {
    created.value = await createAgentTokenApi({
      userId: form.value.userId,
      auctionId: form.value.auctionId,
      scopes: [
        form.value.scopeRead ? 'auction:read' : '',
        form.value.scopeBid ? 'auction:bid' : '',
      ]
        .filter(Boolean)
        .join(','),
      expiresInSeconds: form.value.expiresInSeconds,
      rateLimitPerMin: form.value.rateLimitPerMin,
    })
    await load()
  } catch (e) {
    createError.value = mapError(e, '创建 Token 失败')
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  if (!created.value) return
  try {
    await navigator.clipboard.writeText(created.value.token)
    copied.value = true
  } catch {
    // 剪贴板不可用（非安全上下文）：提示手动复制
    copied.value = false
  }
}

// ---------- 吊销 ----------
const revoking = ref<number | null>(null)
const revokeArmed = ref<number | null>(null)
let revokeArmTimer: number | undefined
const actionError = ref('')

function armRevoke(id: number) {
  revokeArmed.value = id
  if (revokeArmTimer != null) window.clearTimeout(revokeArmTimer)
  revokeArmTimer = window.setTimeout(() => (revokeArmed.value = null), 4000)
}

async function onRevoke(t: AgentTokenInfo) {
  revoking.value = t.tokenId
  actionError.value = ''
  try {
    await revokeAgentTokenApi(t.tokenId)
    t.revoked = true
    await load()
  } catch (e) {
    actionError.value = mapError(e, `吊销 Token #${t.tokenId} 失败`)
  } finally {
    revoking.value = null
    revokeArmed.value = null
  }
}

function isExpired(t: AgentTokenInfo): boolean {
  return t.expiresAt != null && t.expiresAt < Date.now()
}

// ---------- 列表 ----------
async function load() {
  loading.value = true
  listError.value = ''
  try {
    tokens.value = await listAgentTokensApi(filterUserId.value ?? undefined)
  } catch (e) {
    listError.value = mapError(e, '加载 Token 列表失败')
  } finally {
    loading.value = false
  }
}

function mapError(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return '网络异常，请重试'
  switch (e.code) {
    case 1002:
      return '无管理员权限'
    case 1005:
      return '参数校验失败，请检查输入'
    default:
      return e.isNetworkError ? '网络异常，请重试' : e.message || fallback
  }
}

onMounted(async () => {
  load()
  try {
    auctions.value = await listAuctionsApi()
  } catch {
    // 拍卖列表仅用于表单提示，失败不阻塞
  }
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Agent Token 管理</h1>
        <p class="page-sub">供竞拍 Agent（LLM 工具调用）使用的受限凭证：范围限定单场拍卖、最小权限、限频</p>
      </div>
      <RouterLink :to="{ name: 'admin-auctions' }" class="btn btn-ghost">← 拍卖管理</RouterLink>
    </div>

    <!-- 创建 -->
    <div class="card create-card">
      <h3 class="card-title">签发新 Token</h3>
      <div v-if="createError" class="alert alert-error">{{ createError }}</div>

      <div v-if="created" class="alert alert-success token-once">
        <div class="token-once-head">
          <strong>Token 已创建（明文仅显示这一次，请立即复制保存）</strong>
          <button class="btn btn-sm btn-primary" @click="copyToken">
            {{ copied ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <code class="token-plain mono">{{ created.token }}</code>
        <div class="token-meta dim">
          tokenId={{ created.tokenId }} · userId={{ created.userId }} · auctionId={{ created.auctionId }} ·
          scopes={{ created.scopes }} · 过期 {{ formatDateTime(created.expiresAt) }} · 限频 {{ created.rateLimitPerMin }}/min
        </div>
      </div>

      <form class="create-form" @submit.prevent="onCreate">
        <div class="field">
          <label class="field-label">用户 ID</label>
          <input v-model.number="form.userId" class="field-input" type="number" min="1" step="1" placeholder="如 5" />
        </div>
        <div class="field">
          <label class="field-label">拍卖 ID</label>
          <input
            v-model.number="form.auctionId"
            class="field-input"
            type="number"
            min="1"
            step="1"
            list="auction-ids"
            placeholder="如 1"
          />
          <datalist id="auction-ids">
            <option v-for="a in auctions" :key="a.id" :value="a.id">#{{ a.id }} {{ a.title }}（{{ a.status }}）</option>
          </datalist>
        </div>
        <div class="field">
          <label class="field-label">权限（scopes）</label>
          <div class="scope-row">
            <label class="scope-check">
              <input v-model="form.scopeRead" type="checkbox" /> auction:read
            </label>
            <label class="scope-check">
              <input v-model="form.scopeBid" type="checkbox" /> auction:bid
            </label>
          </div>
        </div>
        <div class="field">
          <label class="field-label">有效期（秒）</label>
          <input v-model.number="form.expiresInSeconds" class="field-input" type="number" min="60" step="1" />
        </div>
        <div class="field">
          <label class="field-label">频率限制（次/分钟）</label>
          <input v-model.number="form.rateLimitPerMin" class="field-input" type="number" min="1" step="1" />
        </div>
        <div class="field create-actions">
          <button class="btn btn-primary" type="submit" :disabled="creating">
            {{ creating ? '签发中…' : '签发 Token' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="actionError" class="alert alert-error">{{ actionError }}</div>
    <div v-if="listError" class="alert alert-error">{{ listError }}</div>

    <div class="card">
      <div class="list-head">
        <h3 class="card-title">已签发 Token <span class="title-count">{{ tokens.length }} 个</span></h3>
        <div class="filter-row">
          <input
            v-model.number="filterUserId"
            class="field-input filter-input"
            type="number"
            min="1"
            placeholder="按用户 ID 过滤"
          />
          <button class="btn btn-ghost btn-sm" @click="load()">查询</button>
        </div>
      </div>

      <div v-if="loading" class="loading">
        <span class="spinner"></span>
        加载 Token…
      </div>

      <div v-else-if="tokens.length === 0" class="empty">
        <p>暂无 Token</p>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>前缀</th>
              <th class="num">用户</th>
              <th class="num">拍卖</th>
              <th>权限</th>
              <th>过期时间</th>
              <th>状态</th>
              <th class="num">限频</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tokens" :key="t.tokenId">
              <td class="mono">{{ t.tokenId }}</td>
              <td class="mono dim">{{ t.tokenPrefix }}…</td>
              <td class="num">{{ t.userId }}</td>
              <td class="num">#{{ t.auctionId }}</td>
              <td class="mono dim">{{ t.scopes }}</td>
              <td class="mono dim">{{ formatDateTime(t.expiresAt) }}</td>
              <td>
                <span v-if="t.revoked" class="badge badge-cancelled">已吊销</span>
                <span v-else-if="isExpired(t)" class="badge badge-draft">已过期</span>
                <span v-else class="badge badge-running">有效</span>
              </td>
              <td class="num">{{ t.rateLimitPerMin }}/min</td>
              <td>
                <button
                  v-if="!t.revoked"
                  class="btn btn-sm"
                  :class="revokeArmed === t.tokenId ? 'btn-danger' : 'btn-ghost'"
                  :disabled="revoking === t.tokenId"
                  @click="revokeArmed === t.tokenId ? onRevoke(t) : armRevoke(t.tokenId)"
                >
                  {{ revokeArmed === t.tokenId ? '确认吊销？' : '吊销' }}
                </button>
                <span v-else class="dim">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-card {
  margin-bottom: 16px;
}

.create-form {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}

.create-actions {
  display: flex;
  align-items: flex-end;
  padding-bottom: 16px;
}

.scope-row {
  display: flex;
  gap: 14px;
  padding-top: 8px;
}

.scope-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: var(--ink-2);
  cursor: pointer;
}

.token-once {
  flex-direction: column;
  gap: 8px;
}

.token-once-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.token-plain {
  display: block;
  background: #fff;
  border: 1px dashed var(--gold);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  word-break: break-all;
  color: var(--gold);
  user-select: all;
}

.token-meta {
  font-size: 12px;
}

.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.list-head .card-title {
  margin: 0;
}

.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.filter-input {
  width: 160px;
  padding: 6px 10px;
  font-size: 13px;
}

.title-count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.dim {
  color: var(--muted);
}

@media (max-width: 900px) {
  .create-form {
    grid-template-columns: 1fr;
  }
}
</style>
