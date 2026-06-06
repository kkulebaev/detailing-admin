<script setup lang="ts">
import AppSidebar from '@/components/AppSidebar.vue'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:hidden"
      >
        <SidebarTrigger aria-label="Открыть меню" />
        <span class="text-sm font-semibold">Detailing Admin</span>
      </header>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
