<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { formatPrice } from '@/utils/format'

const auth = useAuthStore()
const walletStore = useWalletStore()
const route = useRoute()
const router = useRouter()

const isAdminRoute = computed(() => route.path.startsWith('/admin'))

// 登录态变化时同步钱包（首次进入 / 切换账号）
watch(
  () => auth.user?.id,
  (uid) => {
    if (uid != null) {
      walletStore.refresh().catch(() => {})
    } else {
      walletStore.clear()
    }
  },
  { immediate: true },
)

async function onLogout() {
  await auth.logout()
  walletStore.clear()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink :to="{ name: 'auction-list' }" class="brand">
          <img src="/favicon.svg" alt="" class="brand-logo" />
          <span class="brand-name">Bid Arena</span>
        </RouterLink>

        <nav v-if="auth.isAuthenticated" class="main-nav">
          <RouterLink :to="{ name: 'auction-list' }" class="nav-link">拍卖列表</RouterLink>
          <RouterLink :to="{ name: 'wallet' }" class="nav-link">钱包</RouterLink>
          <RouterLink
            v-if="auth.isAdmin"
            :to="{ name: 'admin-auctions' }"
            class="nav-link"
            :class="{ active: isAdminRoute }"
          >
            管理
          </RouterLink>
        </nav>

        <div class="header-right">
          <template v-if="auth.isAuthenticated">
            <RouterLink :to="{ name: 'wallet' }" class="wallet-chip" title="可用积分，点击查看钱包">
              <span class="wallet-ico">◈</span>
              <span class="price">{{ walletStore.available != null ? formatPrice(walletStore.available) : '…' }}</span>
              <span v-if="(walletStore.frozen ?? 0) > 0" class="wallet-frozen" title="冻结中">冻 {{ formatPrice(walletStore.frozen) }}</span>
            </RouterLink>
            <span class="user-chip" :title="auth.user?.email">
              <span class="user-role" :class="auth.isAdmin ? 'role-admin' : 'role-user'">{{ auth.isAdmin ? '管理员' : '用户' }}</span>
              <span class="user-name">{{ auth.displayName }}</span>
            </span>
            <button class="btn btn-ghost btn-sm" @click="onLogout">退出</button>
          </template>
        </div>
      </div>
    </header>

    <main class="app-main">
      <RouterView />
    </main>

    <footer class="app-footer">Bid Arena · Solon 3 + Vue 3 全栈拍卖系统</footer>
  </div>
</template>

<style scoped>
.wallet-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--gold-soft);
  border: 1px solid #ecd9a8;
  color: var(--gold);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transition: filter 0.15s;
}

.wallet-chip:hover {
  filter: brightness(0.97);
}

.wallet-ico {
  font-size: 11px;
}

.wallet-frozen {
  font-size: 11px;
  color: var(--warn);
  background: #fff;
  border-radius: 999px;
  padding: 1px 7px;
  font-weight: 600;
}
</style>
