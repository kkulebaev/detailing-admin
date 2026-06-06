<script setup lang="ts">
import { watch } from 'vue'
import { BadgeRussianRuble, CalendarPlus, Users } from '@lucide/vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

const navItems = [
  { to: { name: 'booking' }, label: 'Запись', icon: CalendarPlus },
  { to: { name: 'clients' }, label: 'Клиенты', icon: Users },
  { to: { name: 'pricelist' }, label: 'Прайс', icon: BadgeRussianRuble },
] as const

const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()
watch(() => route.fullPath, () => {
  if (isMobile.value) setOpenMobile(false)
})
</script>

<template>
  <Sidebar>
    <SidebarHeader class="h-14 flex-row items-center border-b border-border px-4">
      <span class="text-base font-semibold">Detailing Admin</span>
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
  </Sidebar>
</template>
