<script setup lang="ts">
import { watch } from 'vue'
import { CalendarPlus, ReceiptText, Users, X } from '@lucide/vue'
import { RouterLink, useRoute } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import { Button } from '@/components/ui/button'
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
  { to: { name: 'pricelist' }, label: 'Прайс', icon: ReceiptText },
] as const

const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()
watch(() => route.fullPath, () => {
  if (isMobile.value) setOpenMobile(false)
})
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
  </Sidebar>
</template>
