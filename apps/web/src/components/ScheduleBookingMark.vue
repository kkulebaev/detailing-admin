<script setup lang="ts">
defineProps<{ count: number; working: boolean }>()
</script>

<template>
  <!-- На выходном цвет берется от ячейки: там он красный, это конфликт с графиком. -->
  <span
    aria-hidden="true"
    class="flex items-center gap-0.5 text-xs leading-none font-medium tabular-nums"
    :class="{ 'text-primary-foreground': working }"
  >
    <span class="size-1.5 rounded-full bg-current" />{{ count }}
  </span>
</template>
