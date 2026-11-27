<script setup lang="ts">
import { TIME_PRESETS } from '@/composables/use-booking-dates'

defineProps<{ active: string }>()
const emit = defineEmits<{ pick: [time: string] }>()
</script>

<template>
  <div class="flex flex-wrap gap-1.5 mt-2">
    <button
      v-for="t in TIME_PRESETS"
      :key="t"
      type="button"
      :data-active="active === t"
      class="text-xs px-2.5 py-1 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
      @click="emit('pick', t)"
    >
      {{ t }}
    </button>
  </div>
</template>
