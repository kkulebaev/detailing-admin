<script setup lang="ts">
import { ChevronDown, X } from '@lucide/vue'
import { computed } from 'vue'
import type { Readiness } from '@detailing-admin/shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { READINESS_FILTER_OPTIONS, readinessFilterLabel } from '@/lib/readiness'

const model = defineModel<(Readiness | '')[]>({ required: true })

// Триггер стоит в одном ряду с селектами фильтров и не должен расти в высоту,
// поэтому вместо бейджей на каждый статус — первый выбранный и счетчик остальных.
const label = computed(() => {
  const [first, ...rest] = model.value
  if (first === undefined) return 'Все'
  const name = readinessFilterLabel(first)
  return rest.length ? `${name} +${rest.length}` : name
})

function toggle(r: Readiness | '') {
  const picked = new Set(model.value)
  if (picked.has(r)) picked.delete(r)
  else picked.add(r)
  // Порядок вариантов, а не кликов: иначе один и тот же набор давал бы разные адреса.
  model.value = READINESS_FILTER_OPTIONS.filter((x) => picked.has(x))
}

const itemClass =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none'
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        data-filter-trigger
        class="w-44 justify-between gap-1 font-normal"
        :title="model.length > 1 ? model.map(readinessFilterLabel).join(', ') : undefined"
        aria-label="Готовность"
      >
        <span class="truncate">{{ label }}</span>
        <ChevronDown class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-56 p-1" align="start">
      <template v-for="r in READINESS_FILTER_OPTIONS" :key="r">
        <!-- «Нет статуса» отделен от рабочих статусов, как в меню выбора статуса. -->
        <div v-if="r === ''" class="-mx-1 my-1 h-px bg-border" />
        <button
          type="button"
          role="checkbox"
          :aria-checked="model.includes(r)"
          :class="[itemClass, r === '' && 'text-muted-foreground']"
          @click="toggle(r)"
        >
          <Checkbox :model-value="model.includes(r)" tabindex="-1" class="pointer-events-none" />
          <span class="truncate">{{ readinessFilterLabel(r) }}</span>
        </button>
      </template>
      <template v-if="model.length">
        <div class="-mx-1 my-1 h-px bg-border" />
        <button type="button" :class="[itemClass, 'text-muted-foreground']" @click="model = []">
          <X class="size-4" /> Все статусы
        </button>
      </template>
    </PopoverContent>
  </Popover>
</template>
