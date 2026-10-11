<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const isAdminRoute = computed(() => route.path.startsWith('/admin'))

async function onLogout() {
  await auth.logout()
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
          <RouterLink v-if="auth.isAdmin" :to="{ name: 'admin-auctions' }" class="nav-link" :class="{ active: isAdminRoute }">管理</RouterLink>
        </nav>

        <div class="header-right">
          <template v-if="auth.isAuthenticated">
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
