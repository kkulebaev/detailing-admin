<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, History } from '@lucide/vue'
import { useBookingHistoryQuery } from '@/lib/queries'
import {
  auditActionLabel,
  auditActor,
  auditFieldLabel,
  formatAuditTime,
  formatAuditValue,
} from '@/lib/booking-audit'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{ bookingId: string }>()

// Журнал нужен редко, поэтому запрос уходит только когда блок раскрыли.
const expanded = ref(false)
const queryId = computed(() => (expanded.value ? props.bookingId : null))
const { data, isLoading, error } = useBookingHistoryQuery(queryId)

watch(
  () => props.bookingId,
  () => (expanded.value = false),
)

const items = computed(() => {
  const d = data.value
  return d?.ok ? [...d.items].reverse() : []
})
const failed = computed(() => error.value != null || (data.value != null && !data.value.ok))
</script>

<template>
  <div class="border-t pt-3">
    <Button
      variant="ghost"
      size="sm"
      class="-ml-2 gap-2 text-muted-foreground"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <History class="size-4" />
      История изменений
      <ChevronDown class="size-4 transition-transform" :class="expanded && 'rotate-180'" />
    </Button>

    <div v-if="expanded" class="mt-2 max-h-72 overflow-y-auto text-sm">
      <div v-if="isLoading" class="space-y-2">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-10 w-full" />
      </div>
      <p v-else-if="failed" class="text-destructive">Не удалось загрузить историю</p>
      <p v-else-if="items.length === 0" class="text-muted-foreground">
        Изменений пока нет. Журнал ведется с момента его появления в приложении.
      </p>
      <ol v-else class="space-y-3">
        <li v-for="entry in items" :key="entry.id">
          <div class="text-xs text-muted-foreground tabular-nums">
            {{ formatAuditTime(entry.at) }} · {{ auditActor(entry) }}
          </div>
          <div>{{ auditActionLabel(entry.action) }}</div>
          <ul v-if="entry.changes?.length" class="mt-1 space-y-0.5">
            <li v-for="change in entry.changes" :key="change.field" class="break-words">
              <span class="text-muted-foreground">{{ auditFieldLabel(change.field) }}:</span>
              <span class="line-through decoration-muted-foreground/60">
                {{ formatAuditValue(change.field, change.from) }}
              </span>
              →
              <span>{{ formatAuditValue(change.field, change.to) }}</span>
            </li>
          </ul>
        </li>
      </ol>
    </div>
  </div>
</template>
