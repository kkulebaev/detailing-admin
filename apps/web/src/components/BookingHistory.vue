<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { ChevronDown, History } from '@lucide/vue'
import { useBookingHistoryQuery } from '@/lib/queries'
import { formatAuditMoment } from '@/lib/booking-audit'
import AuditEntryItem from './AuditEntryItem.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{
  bookingId: string
  // Момент создания из самой записи: нужен, когда в журнале нет события `create`.
  createdAt: string
  initiallyExpanded?: boolean
}>()

// Журнал нужен редко, поэтому запрос уходит только когда блок раскрыли.
const expanded = ref(props.initiallyExpanded ?? false)
const queryId = computed(() => (expanded.value ? props.bookingId : null))
// `isPending`, а не `isLoading`: тот true и при фоновом обновлении, и скелетон
// закрывал бы уже загруженную из кэша историю.
const { data, isPending, error } = useBookingHistoryQuery(queryId)

watch(
  () => props.bookingId,
  () => (expanded.value = props.initiallyExpanded ?? false),
)

const logged = computed(() => {
  const d = data.value
  return d?.ok ? [...d.items].reverse() : []
})

// История начинается с создания записи. У записей старше журнала события `create` нет,
// поэтому достраиваем его из `createdAt`; автор пустой — его тогда не записывали.
const items = computed(() => {
  if (logged.value.some((e) => e.action === 'create')) return logged.value
  return [
    ...logged.value,
    {
      id: -1,
      action: 'create' as const,
      actorLogin: '',
      actorName: '',
      at: props.createdAt,
      changes: null,
    },
  ]
})
const root = useTemplateRef<HTMLElement>('root')
// Кнопка «История» открывает карточку ради истории, а та внизу, под полями записи.
// Прокручиваем к ней, когда она отрисована с данными (из кэша — сразу).
watch(
  () => props.initiallyExpanded && data.value != null,
  async (ready) => {
    if (!ready) return
    await nextTick()
    root.value?.scrollIntoView({ block: 'start' })
  },
  { immediate: true },
)

const failed = computed(() => error.value != null || (data.value != null && !data.value.ok))
</script>

<template>
  <div ref="root" class="border-t pt-3">
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

    <!-- Своя прокрутка только на широком экране: на телефоне вложенный скролл внутри
         прокручиваемой карточки обрезал последнее событие и ловил свайп. -->
    <div v-if="expanded" class="mt-3 sm:max-h-80 sm:overflow-y-auto sm:overscroll-contain">
      <div v-if="isPending" class="space-y-3">
        <Skeleton class="h-12 w-full" />
        <Skeleton class="h-12 w-full" />
      </div>
      <p v-else-if="failed" class="text-sm text-destructive">Не удалось загрузить историю</p>
      <!-- Линия между иконками связывает события в одну хронологию записи. Она стоит
           на половине ширины кружка (size-7 → 3.5) и не тянется ниже последнего. -->
      <ol v-else>
        <li v-for="(entry, i) in items" :key="entry.id" class="relative pb-4 last:pb-0">
          <span
            v-if="i < items.length - 1"
            class="absolute top-8 bottom-0 left-3.5 w-px bg-border"
            aria-hidden="true"
          />
          <AuditEntryItem :entry="entry" :time="formatAuditMoment(entry.at)">
            <p v-if="entry.id < 0" class="text-xs text-muted-foreground">
              Автор неизвестен: запись создана до появления журнала
            </p>
          </AuditEntryItem>
        </li>
      </ol>
    </div>
  </div>
</template>
