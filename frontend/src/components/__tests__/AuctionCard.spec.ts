import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AuctionCard from '../AuctionCard.vue'
import type { Auction } from '@/types'

const baseAuction: Auction = {
  id: 7,
  title: '经典机械腕表',
  description: '九十年代军用潜水表',
  status: 'RUNNING',
  startPrice: 100,
  minIncrement: 10,
  currentPrice: 150,
  currentLeaderId: 3,
  currentLeaderName: '竞拍者A',
  durationSeconds: 180,
  startedAt: 1791617900000,
  endTime: Date.now() + 120_000,
  extendCount: 0,
  maxExtends: 3,
  seq: 5,
  settleReason: null,
  createdAt: 1791617800000,
  participantCount: 4,
  participants: [],
  result: null,
}

const RouterLinkStub = {
  name: 'RouterLink',
  template: '<a :href="`/auctions/${to?.params?.id}`"><slot /></a>',
  props: ['to'],
}

function makeCard(over: Partial<Auction> = {}) {
  return mount(AuctionCard, {
    props: { auction: { ...baseAuction, ...over } },
    global: { components: { RouterLink: RouterLinkStub } },
  })
}

describe('AuctionCard', () => {
  it('missing summary display names use the authoritative user ID instead of undefined', () => {
    const wrapper = makeCard({ currentLeaderName: undefined as unknown as null })
    expect(wrapper.text()).not.toContain('undefined')
    expect(wrapper.text()).toContain('用户 #3')
  })
  it('RUNNING：显示竞拍中徽章、当前价、领先者、参与人数与倒计时', () => {
    const wrapper = makeCard()
    const text = wrapper.text()
    expect(text).toContain('竞拍中')
    expect(text).toContain('当前最高价')
    expect(text).toContain('150')
    expect(text).toContain('领先者 · 竞拍者A')
    expect(text).toContain('4 人参与')
    expect(wrapper.find('.countdown').text()).toMatch(/\d{2}:\d{2}/)
    expect(wrapper.find('a').attributes('href')).toBe('/auctions/7')
  })

  it('无人出价时显示起拍价与暂无出价', () => {
    const wrapper = makeCard({
      status: 'DRAFT',
      currentPrice: 100,
      currentLeaderId: null,
      currentLeaderName: null,
      endTime: null,
    })
    const text = wrapper.text()
    expect(text).toContain('待启动')
    expect(text).toContain('起拍价')
    expect(text).toContain('暂无出价')
    expect(text).toContain('等待管理员启动')
  })

  it('FINISHED：显示成交结果', () => {
    const wrapper = makeCard({
      status: 'FINISHED',
      endTime: Date.now() - 1000,
      result: {
        winnerId: 3,
        winnerName: '竞拍者A',
        finalPrice: 150,
        reason: 'EXPIRED',
        settledAt: Date.now(),
      },
    })
    expect(wrapper.text()).toContain('已成交')
    expect(wrapper.text()).toContain('成交 · 竞拍者A @ 150')
  })

  it('CANCELLED：显示取消说明', () => {
    const wrapper = makeCard({
      status: 'CANCELLED',
      endTime: null,
      result: { winnerId: null, winnerName: null, finalPrice: 0, reason: 'CANCELLED', settledAt: Date.now() },
    })
    expect(wrapper.text()).toContain('已取消')
    expect(wrapper.text()).toContain('冻结已全额释放')
  })
})
