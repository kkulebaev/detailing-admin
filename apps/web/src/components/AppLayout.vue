<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu } from '@lucide/vue'
import AppSidebar from '@/components/AppSidebar.vue'

const mobileOpen = ref(false)
const route = useRoute()
watch(() => route.fullPath, () => { mobileOpen.value = false })
</script>

<template>
  <div class="flex min-h-svh bg-background text-foreground">
    <AppSidebar :mobile-open="mobileOpen" @close="mobileOpen = false" />

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:hidden"
      >
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Открыть меню"
          @click="mobileOpen = true"
        >
          <Menu class="size-5" />
        </button>
        <span class="text-sm font-semibold">Detailing Admin</span>
      </header>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
