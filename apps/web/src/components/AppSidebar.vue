<script setup lang="ts">
import { computed, watch, type Component } from 'vue'
import {
  BarChart3,
  Bell,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Clock,
  LogOut,
  ReceiptText,
  User,
  Users,
  Wallet,
  Wrench,
  X,
} from '@lucide/vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import type { Role } from '@detailing-admin/shared'
import AppLogo from '@/components/AppLogo.vue'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { usePendingScheduleRequestsQuery, useUnreadNotificationsQuery } from '@/lib/queries'
import { useAuthStore } from '@/stores/auth'

interface NavItem {
  to: { name: string }
  label: string
  icon: Component
  roles: readonly Role[]
}

// Сотрудники видят список записей, график и свои часы, букер дополнительно получает
// форму записи; все остальное — только для админа.
const NAV_ITEMS: readonly NavItem[] = [
  {
    to: { name: 'booking' },
    label: 'Новая запись',
    icon: CalendarPlus,
    roles: ['admin', 'booker'],
  },
  {
    to: { name: 'bookings' },
    label: 'Записи',
    icon: ClipboardList,
    roles: ['admin', 'booker', 'employee'],
  },
  { to: { name: 'clients' }, label: 'Клиенты', icon: Users, roles: ['admin'] },
  { to: { name: 'pricelist' }, label: 'Прайс', icon: ReceiptText, roles: ['admin'] },
  { to: { name: 'masters' }, label: 'Мастера', icon: Wrench, roles: ['admin'] },
  {
    to: { name: 'schedule' },
    label: 'График',
    icon: CalendarDays,
    roles: ['admin', 'booker', 'employee'],
  },
  { to: { name: 'salaries' }, label: 'Зарплаты', icon: Wallet, roles: ['admin'] },
  { to: { name: 'analytics' }, label: 'Аналитика', icon: BarChart3, roles: ['admin'] },
  { to: { name: 'employee' }, label: 'Мои часы', icon: Clock, roles: ['booker', 'employee'] },
]

// Общий вид активного состояния для всех пунктов сайдбара (навигация + профиль в футере):
// по умолчанию активный SidebarMenuButton — бледный акцент, а нам нужно, чтобы
// выбранный пункт везде выглядел сплошным темным брендовым primary.
const ACTIVE_CLASS =
  'transition-colors data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-semibold data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground'

const auth = useAuthStore()
const navItems = computed(() => {
  const role = auth.user?.role
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
})

const isAdmin = computed(() => auth.isAdmin)
const { data: pendingRequests, refresh: refreshPending } = usePendingScheduleRequestsQuery(isAdmin)
const { data: unread, refresh: refreshUnread } = useUnreadNotificationsQuery()
// Новые заявки и уведомления не приходят в открытую вкладку сами, а держат ее часами:
// возврат на вкладку colada ловит сама (visibilitychange), а без опроса счетчики
// ждали бы смены фокуса окна.
useIntervalFn(() => {
  if (isAdmin.value) void refreshPending()
  void refreshUnread()
}, 60_000)
const pendingCount = computed(() =>
  pendingRequests.value?.ok ? pendingRequests.value.requests.length : 0,
)
const unreadCount = computed(() => (unread.value?.ok ? unread.value.unreadCount : 0))

function badgeFor(item: NavItem): number {
  return item.to.name === 'schedule' ? pendingCount.value : 0
}

const route = useRoute()
const router = useRouter()
const { isMobile, setOpenMobile } = useSidebar()
watch(
  () => route.fullPath,
  () => {
    if (isMobile.value) setOpenMobile(false)
  },
)

async function onLogout() {
  await auth.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <Sidebar>
    <SidebarHeader class="h-14 flex-row items-center justify-between border-b border-border px-4">
      <AppLogo class="text-base" />
      <Button
        v-if="isMobile"
        variant="ghost"
        size="icon"
        class="-mr-2 h-8 w-8"
        aria-label="Закрыть меню"
        @click="setOpenMobile(false)"
      >
        <X />
      </Button>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in navItems" :key="item.label">
              <SidebarMenuButton
                as-child
                size="lg"
                :is-active="route.name === item.to.name"
                :class="ACTIVE_CLASS"
              >
                <RouterLink :to="item.to">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                  <!-- Внутри ссылки, а не SidebarMenuBadge: тот позиционируется абсолютно
                       под размер кнопки и у пунктов size="lg" уезжал вверх. -->
                  <span
                    v-if="badgeFor(item) > 0"
                    class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs leading-none font-semibold text-white tabular-nums"
                  >
                    <span aria-hidden="true">{{
                      badgeFor(item) > 99 ? '99+' : badgeFor(item)
                    }}</span>
                    <span class="sr-only">, заявок на согласование: {{ badgeFor(item) }}</span>
                  </span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter class="border-t border-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            as-child
            :is-active="route.name === 'notifications'"
            :class="ACTIVE_CLASS"
          >
            <RouterLink :to="{ name: 'notifications' }">
              <Bell />
              <span>Уведомления</span>
              <span
                v-if="unreadCount > 0"
                class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs leading-none font-semibold text-white tabular-nums"
              >
                <span aria-hidden="true">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
                <span class="sr-only">, непрочитанных: {{ unreadCount }}</span>
              </span>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton as-child :is-active="route.name === 'profile'" :class="ACTIVE_CLASS">
            <RouterLink :to="{ name: 'profile' }">
              <User />
              <span class="truncate">{{ auth.displayName || 'Профиль' }}</span>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton @click="onLogout">
            <LogOut />
            <span>Выйти</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
</template>
