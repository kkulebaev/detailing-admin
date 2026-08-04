<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    options: string[]
    disabled?: boolean
    /** Max number of selectable options; unselected options disable once reached. */
    max?: number
    placeholder?: string
    class?: HTMLAttributes['class']
  }>(),
  {
    placeholder: 'Не выбрано',
  },
)

const model = defineModel<string[]>({ default: () => [] })

const limitReached = computed(() => props.max !== undefined && model.value.length >= props.max)

function isSelected(option: string) {
  return model.value.includes(option)
}

function isOptionDisabled(option: string) {
  return props.disabled || (limitReached.value && !isSelected(option))
}

function toggle(option: string) {
  if (isOptionDisabled(option)) return
  model.value = isSelected(option)
    ? model.value.filter((v) => v !== option)
    : [...model.value, option]
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        :disabled="disabled"
        :class="cn(
          'h-auto min-h-9 w-full justify-between gap-1 py-1.5 font-normal',
          model.length === 0 && 'text-muted-foreground',
          props.class,
        )"
      >
        <span v-if="model.length === 0" class="truncate">{{ placeholder }}</span>
        <div v-else class="flex flex-1 flex-wrap items-center gap-1 text-left">
          <Badge v-for="value in model" :key="value" variant="secondary" class="font-normal">
            {{ value }}
          </Badge>
        </div>
        <ChevronDown class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-1" align="start">
      <div class="flex flex-col">
        <div
          v-for="option in options"
          :key="option"
          role="checkbox"
          :aria-checked="isSelected(option)"
          :aria-disabled="isOptionDisabled(option)"
          :class="cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
            isOptionDisabled(option) && 'pointer-events-none cursor-not-allowed opacity-50',
          )"
          @click="toggle(option)"
        >
          <Checkbox :model-value="isSelected(option)" :disabled="isOptionDisabled(option)" class="pointer-events-none" />
          <span class="truncate">{{ option }}</span>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
