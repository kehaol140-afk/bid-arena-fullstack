import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'

vi.mock('@/api/auth', () => ({
  loginApi: vi.fn(),
  logoutApi: vi.fn().mockResolvedValue(null),
  fetchMeApi: vi.fn(),
}))

import { loginApi } from '@/api/auth'

const TOKEN = 'a'.repeat(64)

function okLogin() {
  return Promise.resolve({
    token: TOKEN,
    user: { id: 2, email: 'bidder_a@example.com', displayName: '竞拍者A', role: 'USER' as const },
  })
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(loginApi).mockReset()
  })

  it('login 成功后保存 token 与用户并持久化', async () => {
    vi.mocked(loginApi).mockImplementationOnce(okLogin)
    const auth = useAuthStore()

    await auth.login('bidder_a@example.com', 'Test123456!')

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user?.displayName).toBe('竞拍者A')
    expect(auth.isAdmin).toBe(false)
    expect(localStorage.getItem('bidarena.auth')).toContain(TOKEN)
  })

  it('login 失败（1001 密码错误）不落任何会话', async () => {
    vi.mocked(loginApi).mockRejectedValueOnce(
      Object.assign(new Error('邮箱或密码错误'), { code: 1001, status: 401 }),
    )
    const auth = useAuthStore()

    await expect(auth.login('x@x.com', 'wrong')).rejects.toThrow('邮箱或密码错误')

    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('bidarena.auth')).toBeNull()
  })

  it('restore 从 localStorage 恢复会话且幂等', () => {
    localStorage.setItem(
      'bidarena.auth',
      JSON.stringify({ token: TOKEN, user: { id: 1, email: 'a', displayName: '管理员', role: 'ADMIN' } }),
    )
    const auth = useAuthStore()

    auth.restore()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(auth.ready).toBe(true)

    auth.restore() // 二次调用不重复处理
    expect(auth.isAuthenticated).toBe(true)
  })

  it('logout 调用后端并清理本地会话（即使后端报错）', async () => {
    const { logoutApi } = await import('@/api/auth')
    vi.mocked(logoutApi).mockRejectedValueOnce(new Error('network'))
    localStorage.setItem(
      'bidarena.auth',
      JSON.stringify({ token: TOKEN, user: { id: 2, email: 'a', displayName: 'u', role: 'USER' } }),
    )
    const auth = useAuthStore()
    auth.restore()

    await auth.logout()

    expect(auth.token).toBeNull()
    expect(localStorage.getItem('bidarena.auth')).toBeNull()
  })
})
