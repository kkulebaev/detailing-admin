<script setup lang="ts">
import AppLogo from '@/components/AppLogo.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="min-w-0">
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:hidden"
      >
        <SidebarTrigger aria-label="Открыть меню" />
        <AppLogo class="text-sm" />
      </header>

      <main class="flex min-w-0 flex-1 flex-col">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
