import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import BookingForm from '@/components/BookingForm.vue'

const APP_NAME = 'Dazzle Detailing'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'booking', component: BookingForm, meta: { title: 'Запись клиента' } },
  {
    path: '/clients',
    name: 'clients',
    component: () => import('@/components/ClientsPage.vue'),
    meta: { title: 'Клиенты' },
  },
  {
    path: '/pricelist',
    name: 'pricelist',
    component: () => import('@/components/PricelistPage.vue'),
    meta: { title: 'Прайс-лист' },
  },
  {
    path: '/masters',
    name: 'masters',
    component: () => import('@/components/MastersPage.vue'),
    meta: { title: 'Мастера' },
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'booking' } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} — ${APP_NAME}` : APP_NAME
})
