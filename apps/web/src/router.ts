import {
  createRouter,
  createWebHistory,
  type Router,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router'
import { canCreateBookings, type Role } from '@detailing-admin/shared'
import BookingForm from '@/components/BookingForm.vue'
import { useAuthStore } from '@/stores/auth'

const APP_NAME = 'Dazzle Detailing'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    // Маршрут без обоих флагов по умолчанию открыт — сейчас таких нет,
    // но `requiresAuth` задан явно, чтобы это не стало тихой ловушкой.
    public?: boolean
    requiresAuth?: boolean
    roles?: Role[]
  }
}

export function homeRouteFor(role: Role): { name: string } {
  return canCreateBookings(role) ? { name: 'booking' } : { name: 'employee' }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { title: 'Вход', public: true },
  },
  {
    path: '/',
    name: 'booking',
    component: BookingForm,
    meta: { title: 'Запись клиента', requiresAuth: true, roles: ['admin', 'booker'] },
  },
  {
    path: '/bookings',
    name: 'bookings',
    component: () => import('@/components/BookingsPage.vue'),
    meta: { title: 'Записи', requiresAuth: true, roles: ['admin', 'booker', 'employee'] },
  },
  {
    path: '/clients',
    name: 'clients',
    component: () => import('@/components/ClientsPage.vue'),
    meta: { title: 'Клиенты', requiresAuth: true, roles: ['admin'] },
  },
  {
    // Плоско, без вложенности: у ClientsPage нет внутреннего <router-view>. И /clients,
    // и /clients/:id указывают на ОДИН компонент, поэтому vue-router переиспользует
    // смонтированный экземпляр — список остаётся живым (фильтры/страница сохраняются),
    // а Sheet с деталями выезжает поверх него, и прямые ссылки открывают его сразу.
    path: '/clients/:id',
    name: 'client-detail',
    component: () => import('@/components/ClientsPage.vue'),
    meta: { title: 'Клиенты', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/pricelist',
    name: 'pricelist',
    component: () => import('@/components/PricelistPage.vue'),
    meta: { title: 'Прайс-лист', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/masters',
    name: 'masters',
    component: () => import('@/components/MastersPage.vue'),
    meta: { title: 'Мастера', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/salaries',
    name: 'salaries',
    component: () => import('@/components/SalariesPage.vue'),
    meta: { title: 'Зарплаты', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: () => import('@/components/AnalyticsPage.vue'),
    meta: { title: 'Аналитика', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/employee',
    name: 'employee',
    component: () => import('@/pages/MyHoursPage.vue'),
    meta: { title: 'Мои часы', requiresAuth: true, roles: ['booker', 'employee'] },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/pages/ProfilePage.vue'),
    meta: { title: 'Профиль', requiresAuth: true, roles: ['admin', 'booker', 'employee'] },
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'booking' } },
]

// Фабрика вместо голого синглтона, чтобы тесты могли поднимать изолированный
// роутер (memory history + свежие замыкания guard'ов) на каждый кейс; `router` ниже —
// единственный экземпляр, который монтирует само приложение.
export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const appRouter = createRouter({ history, routes })

  appRouter.beforeEach(async (to) => {
    const auth = useAuthStore()
    // Резолвится один раз за загрузку приложения — последующие навигации
    // переиспользуют сессию, которую уже установил `fetchMe()` (или предыдущий логин).
    if (!auth.ready) {
      await auth.fetchMe()
    }

    if (to.name === 'login') {
      return auth.user ? homeRouteFor(auth.user.role) : true
    }

    if (!to.meta.requiresAuth) return true

    if (!auth.user) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (to.meta.roles && !to.meta.roles.includes(auth.user.role)) {
      return homeRouteFor(auth.user.role)
    }

    return true
  })

  appRouter.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} — ${APP_NAME}` : APP_NAME
  })

  return appRouter
}

export const router = createAppRouter()
