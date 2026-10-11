import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { setUnauthorizedHandler } from './api/http'
import './assets/main.css'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)

const auth = useAuthStore(pinia)
auth.restore()

// 会话失效（携带 token 却收到 401/1001）→ 清会话并回登录页
setUnauthorizedHandler(() => {
  auth.clearSession()
  const current = router.currentRoute.value
  if (current.name !== 'login') {
    router.push({ name: 'login', query: { redirect: current.fullPath } })
  }
})

app.use(router)
app.mount('#app')
