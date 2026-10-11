import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Countdown from '../Countdown.vue'

describe('Countdown', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('显示剩余时间并随时间流逝刷新', async () => {
    const end = Date.now() + 90_000
    const wrapper = mount(Countdown, { props: { endTime: end } })

    expect(wrapper.text()).toBe('01:30')

    vi.advanceTimersByTime(30_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('01:00')
  })

  it('已过期显示 00:00 并触发 ended 一次', async () => {
    const end = Date.now() - 1000
    const wrapper = mount(Countdown, { props: { endTime: end } })

    vi.advanceTimersByTime(300)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toBe('00:00')
    expect(wrapper.emitted('ended')).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(wrapper.emitted('ended')).toHaveLength(1) // 不重复
  })

  it('endTime 更新后重新计时', async () => {
    const end = Date.now() + 60_000
    const wrapper = mount(Countdown, { props: { endTime: end } })
    expect(wrapper.text()).toBe('01:00')

    await wrapper.setProps({ endTime: Date.now() + 120_000 })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('02:00')
  })
})
