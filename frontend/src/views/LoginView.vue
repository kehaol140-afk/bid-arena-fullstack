<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/http'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')

const DEMO_ACCOUNTS = [
  { role: '管理员', mail: 'admin@example.com', password: 'Admin123456!' },
  { role: '竞拍者A', mail: 'bidder_a@example.com', password: 'Test123456!' },
]

function fillDemo(acc: { mail: string; password: string }) {
  email.value = acc.mail
  password.value = acc.password
  error.value = ''
}

async function onSubmit() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = '请输入邮箱和密码'
    return
  }
  submitting.value = true
  try {
    await auth.login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    if (redirect && redirect.startsWith('/')) {
      router.push(redirect)
    } else {
      router.push({ name: 'auction-list' })
    }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 1001) error.value = '邮箱或密码错误'
      else if (e.isNetworkError) error.value = '无法连接服务器，请确认后端已启动（:8090）'
      else error.value = e.message || '登录失败'
    } else {
      error.value = '登录失败，请重试'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <img src="/favicon.svg" alt="Bid Arena" />
        <h1 class="login-title">Bid Arena</h1>
        <p class="login-sub">实时竞价 · 钱包冻结 · 公平结算</p>
      </div>

      <form @submit.prevent="onSubmit" novalidate>
        <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

        <div class="field">
          <label class="field-label" for="login-email">邮箱</label>
          <input
            id="login-email"
            v-model="email"
            class="field-input"
            type="email"
            autocomplete="username"
            placeholder="you@example.com"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field-label" for="login-password">密码</label>
          <input
            id="login-password"
            v-model="password"
            class="field-input"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••••"
            :disabled="submitting"
          />
        </div>

        <button class="btn btn-primary btn-lg btn-block" type="submit" :disabled="submitting">
          {{ submitting ? '登录中…' : '登 录' }}
        </button>
      </form>

      <div class="demo-accounts">
        <div class="demo-accounts-label">演示账号（点击自动填充）</div>
        <div class="demo-row">
          <button
            v-for="acc in DEMO_ACCOUNTS"
            :key="acc.mail"
            type="button"
            class="demo-btn"
            :title="acc.password"
            @click="fillDemo(acc)"
          >
            <span class="demo-role">{{ acc.role }}</span>
            <span class="demo-mail">{{ acc.mail }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
