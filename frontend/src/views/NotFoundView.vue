<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="empty">
    <div class="empty-icon">🗺️</div>
    <p>页面不存在</p>
    <button class="btn btn-ghost" @click="router.push({ name: 'auction-list' })">返回拍卖列表</button>
  </div>
</template>
