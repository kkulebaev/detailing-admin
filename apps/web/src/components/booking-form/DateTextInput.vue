<script setup lang="ts">
import { Calendar as CalendarIcon } from '@lucide/vue'
import type { DateValue } from 'reka-ui'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

defineProps<{ cal: DateValue; invalid: boolean; calendarLabel: string }>()
const text = defineModel<string>('text', { required: true })
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ input: [e: Event]; select: [date: DateValue | undefined] }>()
</script>

<template>
  <div class="relative flex-1">
    <Input
      type="text"
      inputmode="numeric"
      class="h-11 pr-10"
      placeholder="ДД.ММ.ГГГГ"
      v-model="text"
      :aria-invalid="invalid"
      @input="emit('input', $event)"
    />
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          :aria-label="calendarLabel"
          class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
        >
          <CalendarIcon class="size-4.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0" align="start">
        <Calendar locale="ru-RU" :model-value="cal" @update:model-value="emit('select', $event)" />
      </PopoverContent>
    </Popover>
  </div>
</template>
