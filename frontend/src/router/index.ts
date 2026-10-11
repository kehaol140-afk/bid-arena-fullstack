import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/auctions',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/auctions',
      name: 'auction-list',
      component: () => import('@/views/AuctionListView.vue'),
    },
    {
      path: '/auctions/:id(\\d+)',
      name: 'auction-room',
      component: () => import('@/views/AuctionRoomView.vue'),
      props: true,
    },
    {
      path: '/wallet',
      name: 'wallet',
      component: () => import('@/views/WalletView.vue'),
    },
    {
      path: '/admin/auctions',
      name: 'admin-auctions',
      component: () => import('@/views/AdminAuctionsView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/agent-tokens',
      name: 'agent-tokens',
      component: () => import('@/views/AgentTokensView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { public: true },
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  auth.restore()

  if (to.meta.public) {
    // 已登录访问登录页 → 回大厅
    if (to.name === 'login' && auth.isAuthenticated) {
      return { name: 'auction-list' }
    }
    return true
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'auction-list' }
  }
  return true
})

export default router
