import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import { setUnauthorizedHandler } from './lib/orval-mutator'
import 'vue-sonner/style.css'
import './styles/globals.css'

const app = createApp(App)
app.use(createPinia())
app.use(PiniaColada)
app.use(router)

// Wired here, not inside orval-mutator.ts: auth-api.ts (and everything that
// calls it) sits below that module, while the store/router that need to
// react to a 401 sit above it — a static import in either direction would
// cycle.
setUnauthorizedHandler(() => {
  useAuthStore().clearSession()
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
})

app.mount('#app')
