<script setup lang="ts">
import { computed, watch, type Component } from 'vue'
import { CalendarPlus, LogOut, ReceiptText, User, Users, Wrench, X } from '@lucide/vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
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
import { useAuthStore } from '@/stores/auth'

interface NavItem {
  to: { name: string }
  label: string
  icon: Component
  roles: readonly Role[]
}

// All existing sections are admin-only; employee gets the stub home only —
// see .omc/plans/auth-rbac-plan.md's access matrix (real employee rights land later).
const NAV_ITEMS: readonly NavItem[] = [
  { to: { name: 'booking' }, label: 'Запись', icon: CalendarPlus, roles: ['admin'] },
  { to: { name: 'clients' }, label: 'Клиенты', icon: Users, roles: ['admin'] },
  { to: { name: 'pricelist' }, label: 'Прайс', icon: ReceiptText, roles: ['admin'] },
  { to: { name: 'masters' }, label: 'Мастера', icon: Wrench, roles: ['admin'] },
  { to: { name: 'employee' }, label: 'Главная', icon: CalendarPlus, roles: ['employee'] },
]

const auth = useAuthStore()
const navItems = computed(() => {
  const role = auth.user?.role
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
})

const route = useRoute()
const router = useRouter()
const { isMobile, setOpenMobile } = useSidebar()
watch(() => route.fullPath, () => {
  if (isMobile.value) setOpenMobile(false)
})

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
                class="transition-colors data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-semibold data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
              >
                <RouterLink :to="item.to">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
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
          <SidebarMenuButton as-child :is-active="route.name === 'profile'">
            <RouterLink :to="{ name: 'profile' }">
              <User />
              <span class="truncate">{{ auth.user?.login ?? 'Профиль' }}</span>
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
