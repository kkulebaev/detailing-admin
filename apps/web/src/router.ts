import {
  createRouter,
  createWebHistory,
  type Router,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router'
import type { Role } from '@detailing-admin/shared'
import BookingForm from '@/components/BookingForm.vue'
import { useAuthStore } from '@/stores/auth'

const APP_NAME = 'Dazzle Detailing'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    // A route with neither flag stays open by default — none exist today,
    // but `requiresAuth` is explicit so that isn't a silent trap.
    public?: boolean
    requiresAuth?: boolean
    roles?: Role[]
  }
}

export function homeRouteFor(role: Role): { name: string } {
  return role === 'admin' ? { name: 'booking' } : { name: 'employee' }
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
    meta: { title: 'Запись клиента', requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/bookings',
    name: 'bookings',
    component: () => import('@/components/BookingsPage.vue'),
    meta: { title: 'Записи', requiresAuth: true, roles: ['admin', 'employee'] },
  },
  {
    path: '/clients',
    name: 'clients',
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
    component: () => import('@/pages/EmployeeHome.vue'),
    meta: { title: 'Главная', requiresAuth: true, roles: ['employee'] },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/pages/ProfilePage.vue'),
    meta: { title: 'Профиль', requiresAuth: true, roles: ['admin', 'employee'] },
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'booking' } },
]

// Factory instead of a bare singleton so tests can spin up an isolated
// router (memory history + fresh guard closures) per case; `router` below is
// the one instance the app itself mounts.
export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const appRouter = createRouter({ history, routes })

  appRouter.beforeEach(async (to) => {
    const auth = useAuthStore()
    // Resolves once per app load — later navigations reuse the session
    // `fetchMe()` (or a prior login) already settled.
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
