import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router, type RouteRecordRaw } from 'vue-router'

const Blank = defineComponent({ render: () => null })

// Страницы держат фильтры в адресе, поэтому им нужен настоящий роутер. Страница
// монтируется напрямую, без RouterView: маршруты-заглушки нужны только адресу.
// `slowGuardMs` растягивает каждую навигацию после beforeEach, как ленивый чанк
// страницы в приложении, чтобы гонки с ней можно было поймать.
export async function createTestRouter(
  path = '/',
  options: { routes?: RouteRecordRaw[]; slowGuardMs?: number } = {},
): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: options.routes ?? [
      { path: '/other', name: 'other', component: Blank },
      { path: '/:any(.*)*', name: 'page', component: Blank },
    ],
  })
  const delay = options.slowGuardMs
  if (delay) router.beforeResolve(() => new Promise<void>((r) => setTimeout(r, delay)))
  await router.push(path)
  await router.isReady()
  return router
}

export function blankRoute(path: string, name: string): RouteRecordRaw {
  return { path, name, component: Blank }
}
