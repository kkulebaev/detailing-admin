<script setup lang="ts">
import { CalendarPlus, Users, X } from '@lucide/vue'
import { RouterLink } from 'vue-router'

defineProps<{ mobileOpen: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const navItems = [
  { to: { name: 'booking' }, label: 'Запись', icon: CalendarPlus },
  { to: { name: 'clients' }, label: 'Клиенты', icon: Users },
] as const
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-foreground/40 md:hidden"
      aria-hidden="true"
      @click="emit('close')"
    />
  </Transition>

  <aside
    class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card text-card-foreground shadow-lg transition-transform duration-200 md:static md:z-auto md:shadow-none md:translate-x-0"
    :class="mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    aria-label="Основная навигация"
  >
    <div class="flex h-14 items-center justify-between border-b border-border px-4">
      <span class="text-base font-semibold">Detailing Admin</span>
      <button
        type="button"
        class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Закрыть меню"
        @click="emit('close')"
      >
        <X class="size-5" />
      </button>
    </div>

    <nav class="flex-1 overflow-y-auto p-3">
      <ul class="space-y-1">
        <li v-for="item in navItems" :key="item.label">
          <RouterLink
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent text-accent-foreground"
            @click="emit('close')"
          >
            <component :is="item.icon" class="size-4" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </aside>
</template>
