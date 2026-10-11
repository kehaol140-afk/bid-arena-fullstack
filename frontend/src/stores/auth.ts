import { defineStore } from 'pinia'
import { loginApi, logoutApi, fetchMeApi } from '@/api/auth'
import { readAuth, writeAuth, clearAuth } from '@/utils/authStorage'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    user: null as User | null,
    /** 是否已完成本地会话恢复（路由守卫用） */
    ready: false,
  }),
  getters: {
    isAuthenticated: (s): boolean => !!s.token,
    isAdmin: (s): boolean => s.user?.role === 'ADMIN',
    displayName: (s): string => s.user?.displayName ?? '',
  },
  actions: {
    /** 从 localStorage 恢复会话（幂等） */
    restore() {
      if (this.ready) return
      const saved = readAuth()
      if (saved) {
        this.token = saved.token
        this.user = saved.user
      }
      this.ready = true
    },
    async login(email: string, password: string) {
      const data = await loginApi({ email, password })
      this.token = data.token
      this.user = data.user
      this.ready = true
      writeAuth({ token: data.token, user: data.user })
    },
    async logout() {
      try {
        if (this.token) await logoutApi()
      } catch {
        // 服务端会话清理失败不阻塞本地登出
      }
      this.clearSession()
    },
    /** 刷新当前用户信息（会话过期时由 http 层统一处理） */
    async refreshUser() {
      if (!this.token) return
      try {
        this.user = await fetchMeApi()
        writeAuth({ token: this.token, user: this.user })
      } catch {
        // 忽略：401 已由全局处理器接管
      }
    },
    clearSession() {
      this.token = null
      this.user = null
      clearAuth()
    },
  },
})
