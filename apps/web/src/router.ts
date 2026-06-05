import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import BookingForm from '@/components/BookingForm.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'booking', component: BookingForm },
  {
    path: '/clients',
    name: 'clients',
    component: () => import('@/components/ClientsPage.vue'),
  },
  {
    path: '/pricelist',
    name: 'pricelist',
    component: () => import('@/components/PricelistPage.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'booking' } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
