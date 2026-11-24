<script setup lang="ts" generic="T extends string">
import { ChevronDown, X } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = withDefaults(
  defineProps<{
    options: readonly T[]
    /** Подпись поля: aria-label триггера. */
    label: string
    optionLabel?: (value: T) => string
    /** Служебный вариант (например, «Нет статуса»): отделен чертой и приглушен. */
    isSecondary?: (value: T) => boolean
    clearLabel?: string
  }>(),
  {
    optionLabel: (value: string) => value,
    isSecondary: () => false,
    clearLabel: 'Сбросить',
  },
)

const model = defineModel<T[]>({ required: true })

// Триггер стоит в одном ряду с селектами фильтров и не должен расти в высоту,
// поэтому вместо бейджей на каждый вариант — первый выбранный и счетчик остальных.
const triggerText = computed(() => {
  const [first, ...rest] = model.value
  if (first === undefined) return 'Все'
  const name = props.optionLabel(first)
  return rest.length ? `${name} +${rest.length}` : name
})

function toggle(value: T) {
  const picked = new Set(model.value)
  if (picked.has(value)) picked.delete(value)
  else picked.add(value)
  // Порядок вариантов, а не кликов: иначе один и тот же набор давал бы разные адреса.
  model.value = props.options.filter((o) => picked.has(o))
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
        :title="model.length > 1 ? model.map(props.optionLabel).join(', ') : undefined"
        :aria-label="label"
      >
        <span class="truncate">{{ triggerText }}</span>
        <ChevronDown class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      class="max-h-(--reka-popover-content-available-height) w-56 overflow-y-auto p-1"
      align="start"
    >
      <template v-for="(o, i) in options" :key="o">
        <div
          v-if="isSecondary(o) && i > 0 && !isSecondary(options[i - 1]!)"
          class="-mx-1 my-1 h-px bg-border"
        />
        <button
          type="button"
          role="checkbox"
          :aria-checked="model.includes(o)"
          :class="[itemClass, isSecondary(o) && 'text-muted-foreground']"
          @click="toggle(o)"
        >
          <Checkbox :model-value="model.includes(o)" tabindex="-1" class="pointer-events-none" />
          <span class="truncate">{{ optionLabel(o) }}</span>
        </button>
      </template>
      <template v-if="model.length">
        <div class="-mx-1 my-1 h-px bg-border" />
        <button type="button" :class="[itemClass, 'text-muted-foreground']" @click="model = []">
          <X class="size-4" /> {{ clearLabel }}
        </button>
      </template>
    </PopoverContent>
  </Popover>
</template>
