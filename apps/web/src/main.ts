import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { PiniaColadaRetry } from '@pinia/colada-plugin-retry'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import { setUnauthorizedHandler } from './lib/orval-mutator'
import 'vue-sonner/style.css'
import './styles/globals.css'

const app = createApp(App)
app.use(createPinia())
// Only a dropped connection or a non-JSON reply (a proxy's 502 page) reaches this
// as an error: `orvalFetch` hands HTTP errors back as `{ ok: false }` data, so a
// 401 or 404 is never retried. Only reads go through colada, so a retry can't
// duplicate a booking.
app.use(PiniaColada, { plugins: [PiniaColadaRetry()] })
app.use(router)

// Wired here, not inside orval-mutator.ts: auth-api.ts (and everything that
// calls it) sits below that module, while the store/router that need to
// react to a 401 sit above it — a static import in either direction would
// cycle.
setUnauthorizedHandler(() => {
  useAuthStore().clearSession()
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
})

// Mount only after the initial navigation settles. Its guard awaits
// `fetchMe()`, so the first paint is already the resolved route — without this
// the app flashes the authenticated layout/sidebar for one frame (START
// location has empty `meta`, so `App.vue` treats it as non-public) while
// GET /api/auth/me is still in flight, then snaps to the bare /login page.
async function mountWhenReady() {
  try {
    await router.isReady()
  } finally {
    app.mount('#app')
  }
}

void mountWhenReady()
