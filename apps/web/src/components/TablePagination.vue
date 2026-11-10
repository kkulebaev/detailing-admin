<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

const props = withDefaults(
  defineProps<{
    total: number
    itemsPerPage: number
    disabled?: boolean
  }>(),
  { disabled: false },
)

const page = defineModel<number>('page', { required: true })

const isDesktop = useMediaQuery('(min-width: 640px)')
const siblingCount = computed(() => (isDesktop.value ? 1 : 0))

const rangeStart = computed(() =>
  props.total === 0 ? 0 : (page.value - 1) * props.itemsPerPage + 1,
)
const rangeEnd = computed(() => Math.min(page.value * props.itemsPerPage, props.total))

// На мобильном разделитель «из» заменён на «/», чтобы счётчик оставался в одной
// строке с пагинацией даже на трёхзначных страницах («501–518/518»).
const rangeLabel = computed(() => {
  if (props.total === 0) return 'Всего: 0'
  const separator = isDesktop.value ? ' из ' : '/'
  return `${rangeStart.value}–${rangeEnd.value}${separator}${props.total}`
})

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.itemsPerPage)))

type PaginationEntry = { type: 'page'; value: number } | { type: 'ellipsis' }

// Собственный список reka-ui держит по три номера в начале и конце, и вместе
// с текстом диапазона это переносится на вторую строку при ~320px. На мобильном
// рисуем набор плотнее: первая, последняя, текущая (плюс один сосед, чтобы
// крайние страницы читались «1 2 … 11»), всё остальное — в одно многоточие.
const mobileItems = computed<PaginationEntry[]>(() => {
  const last = pageCount.value
  const current = page.value
  const wanted = new Set([1, last, current])
  if (current <= 2) wanted.add(2)
  else if (current >= last - 1) wanted.add(last - 1)

  const pages = [...wanted].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b)
  const entries: PaginationEntry[] = []
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) entries.push({ type: 'ellipsis' })
    entries.push({ type: 'page', value: pages[i] })
  }
  return entries
})
</script>

<template>
  <div class="mt-4 shrink-0 flex flex-wrap items-center justify-between gap-1.5 sm:gap-3">
    <p class="text-sm text-muted-foreground tabular-nums">{{ rangeLabel }}</p>
    <Pagination
      v-model:page="page"
      :items-per-page="itemsPerPage"
      :total="total"
      :sibling-count="siblingCount"
      :disabled="disabled"
      show-edges
      class="mx-0 w-auto"
    >
      <PaginationContent v-slot="{ items }" class="gap-0.5">
        <PaginationPrevious size="sm" aria-label="Предыдущая страница" class="px-1 sm:px-2.5">
          <ChevronLeft class="size-4" />
        </PaginationPrevious>
        <template v-for="(item, index) in isDesktop ? items : mobileItems" :key="index">
          <PaginationItem
            v-if="item.type === 'page'"
            :value="item.value"
            :is-active="item.value === page"
            size="sm"
            class="px-1.5 sm:px-3"
          >
            {{ item.value }}
          </PaginationItem>
          <PaginationEllipsis v-else :index="index" class="size-5 sm:size-9" />
        </template>
        <PaginationNext size="sm" aria-label="Следующая страница" class="px-1 sm:px-2.5">
          <ChevronRight class="size-4" />
        </PaginationNext>
      </PaginationContent>
    </Pagination>
  </div>
</template>
