<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

// Заглушка в форме `AuditEntryItem`, чтобы при загрузке не прыгала раскладка.
// В общем журнале под шапкой еще две строки о самой записи.
const props = defineProps<{ withBooking?: boolean }>()
</script>

<template>
  <div class="flex gap-3" aria-hidden="true">
    <Skeleton class="mt-0.5 size-7 shrink-0 rounded-full" />
    <div class="flex-1 space-y-2 pt-1">
      <div class="flex justify-between gap-2">
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-3 w-10" />
      </div>
      <template v-if="props.withBooking">
        <Skeleton class="h-4 w-48" />
        <Skeleton class="h-3 w-28" />
      </template>
      <Skeleton v-else class="h-3 w-24" />
    </div>
  </div>
</template>
