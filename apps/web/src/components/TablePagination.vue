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

// Narrow screens can't fit a full sibling window, so collapse to
// «первая … текущая … последняя» on mobile and widen it from sm up.
const isDesktop = useMediaQuery('(min-width: 640px)')
const siblingCount = computed(() => (isDesktop.value ? 1 : 0))

const rangeStart = computed(() =>
  props.total === 0 ? 0 : (page.value - 1) * props.itemsPerPage + 1,
)
const rangeEnd = computed(() => Math.min(page.value * props.itemsPerPage, props.total))
</script>

<template>
  <div class="mt-4 shrink-0 flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-muted-foreground tabular-nums">
      <template v-if="total > 0">{{ rangeStart }}–{{ rangeEnd }} из {{ total }}</template>
      <template v-else>Всего: 0</template>
    </p>
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
        <PaginationPrevious size="sm" aria-label="Предыдущая страница">
          <ChevronLeft class="size-4" />
        </PaginationPrevious>
        <template v-for="(item, index) in items" :key="index">
          <PaginationItem
            v-if="item.type === 'page'"
            :value="item.value"
            :is-active="item.value === page"
            size="sm"
            class="px-2 sm:px-3"
          >
            {{ item.value }}
          </PaginationItem>
          <PaginationEllipsis v-else :index="index" class="size-8" />
        </template>
        <PaginationNext size="sm" aria-label="Следующая страница">
          <ChevronRight class="size-4" />
        </PaginationNext>
      </PaginationContent>
    </Pagination>
  </div>
</template>
