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
// Сюда как ошибка доходят только обрыв соединения или не-JSON ответ (страница 502
// от прокси): HTTP-ошибки `orvalFetch` возвращает данными `{ ok: false }`, так что
// 401 или 404 никогда не ретраятся. Через colada идут только чтения, поэтому ретрай
// не может задублировать запись.
app.use(PiniaColada, { plugins: [PiniaColadaRetry()] })
app.use(router)

// Подключается здесь, а не внутри orval-mutator.ts: auth-api.ts (и все, что его
// вызывает) лежит ниже этого модуля, а store/router, которым нужно реагировать
// на 401, — выше; статический импорт в любую сторону дал бы
// цикл.
setUnauthorizedHandler(() => {
  useAuthStore().clearSession()
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
})

// Монтируем только после того, как завершится первая навигация. Ее guard ждет
// `fetchMe()`, поэтому первая отрисовка — уже итоговый маршрут; без этого
// приложение на один кадр показывает авторизованный лейаут/сайдбар (у START
// location пустой `meta`, и `App.vue` считает его непубличным), пока
// GET /api/auth/me еще в полете, а затем резко переключается на голую страницу /login.
async function mountWhenReady() {
  try {
    await router.isReady()
  } finally {
    app.mount('#app')
  }
}

void mountWhenReady()
