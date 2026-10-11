import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from '../LoginView.vue'
import { useAuthStore } from '@/stores/auth'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} as Record<string, string> }),
  useRouter: () => ({ push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/api/auth', () => ({
  loginApi: vi.fn(),
  logoutApi: vi.fn(),
  fetchMeApi: vi.fn(),
}))

import { loginApi } from '@/api/auth'
import { ApiError } from '@/api/http'

function mountLogin() {
  return mount(LoginView, {
    global: {
      components: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    push.mockReset()
    vi.mocked(loginApi).mockReset()
  })

  it('空表单提交显示校验提示，不调用 API', async () => {
    const wrapper = mountLogin()
    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.text()).toContain('请输入邮箱和密码')
    expect(loginApi).not.toHaveBeenCalled()
  })

  it('登录失败（1001）显示「邮箱或密码错误」且不落会话', async () => {
    vi.mocked(loginApi).mockRejectedValueOnce(new ApiError(1001, '邮箱或密码错误', 401))
    const wrapper = mountLogin()

    await wrapper.find('#login-email').setValue('bidder_a@example.com')
    await wrapper.find('#login-password').setValue('wrong-password')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('邮箱或密码错误')
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('登录成功写入会话并跳转拍卖列表', async () => {
    vi.mocked(loginApi).mockResolvedValueOnce({
      token: 't'.repeat(64),
      user: { id: 1, email: 'admin@example.com', displayName: '管理员', role: 'ADMIN' },
    })
    const wrapper = mountLogin()

    await wrapper.find('#login-email').setValue('admin@example.com')
    await wrapper.find('#login-password').setValue('Test123456!')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(push).toHaveBeenCalledWith({ name: 'auction-list' })
  })

  it('演示账号按钮自动填充邮箱与密码', async () => {
    const wrapper = mountLogin()
    const demoBtn = wrapper.findAll('.demo-btn').find((b) => b.text().includes('bidder_a'))
    expect(demoBtn).toBeTruthy()
    await demoBtn!.trigger('click')

    expect((wrapper.find('#login-email').element as HTMLInputElement).value).toBe('bidder_a@example.com')
    expect((wrapper.find('#login-password').element as HTMLInputElement).value).toBe('Test123456!')
  })
})
