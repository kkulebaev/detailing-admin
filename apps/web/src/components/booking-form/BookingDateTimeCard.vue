<script setup lang="ts">
import type { BookingDates } from '@/composables/use-booking-dates'
import { useShownErrors } from '@/composables/use-shown-errors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import DateTextInput from './DateTextInput.vue'
import TimePresetChips from './TimePresetChips.vue'

const props = defineProps<{ dates: BookingDates }>()
// Объект из composable не меняется за время жизни формы, поэтому его ref можно
// разобрать один раз: шаблон развернет их сам.
const {
  dateFromCal,
  dateToCal,
  dateFromText,
  dateToText,
  timeValue,
  timeToValue,
  isRangeMode,
  dateFromOpen,
  dateToOpen,
  activeDayOffset,
  pickDay,
  toggleRangeMode,
  pickTime,
  pickTimeTo,
  onDateFromTextInput,
  onDateToTextInput,
  onTimeTextInput,
  onTimeToTextInput,
  onDateFromSelect,
  onDateToSelect,
} = props.dates

const shownError = useShownErrors()

const DAY_CHIPS = [
  { offset: 0, label: 'Сегодня' },
  { offset: 1, label: 'Завтра' },
  { offset: 2, label: 'Послезавтра' },
] as const
const CHIP_CLASS =
  'text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary'
</script>

<template>
  <Card class="gap-4 py-4 shadow-none">
    <CardHeader class="px-4">
      <CardTitle class="text-base">Дата и время записи</CardTitle>
    </CardHeader>
    <CardContent class="px-4">
      <div class="flex flex-wrap gap-2 mb-2">
        <button
          v-for="chip in DAY_CHIPS"
          :key="chip.offset"
          type="button"
          :data-active="activeDayOffset === chip.offset"
          :class="CHIP_CLASS"
          @click="pickDay(chip.offset)"
        >
          {{ chip.label }}
        </button>
        <button
          type="button"
          :data-active="isRangeMode"
          :class="CHIP_CLASS"
          @click="toggleRangeMode"
        >
          Диапазон
        </button>
      </div>

      <div class="flex gap-2">
        <DateTextInput
          v-model:text="dateFromText"
          v-model:open="dateFromOpen"
          :cal="dateFromCal"
          :invalid="!!shownError('dateFrom')"
          calendar-label="Выбрать дату в календаре"
          @input="onDateFromTextInput"
          @select="onDateFromSelect"
        />
        <Input
          type="text"
          inputmode="numeric"
          class="h-11 w-24"
          placeholder="ЧЧ:ММ"
          v-model="timeValue"
          :aria-invalid="!!shownError('time')"
          @input="onTimeTextInput"
        />
      </div>

      <TimePresetChips :active="timeValue" @pick="pickTime" />

      <p v-if="shownError('time')" class="text-sm font-medium text-destructive mt-1">
        {{ shownError('time') }}
      </p>

      <!-- Окончание работ — плавно раскрывается/сворачивается при переключении режима
         диапазона. Внешний grid анимирует grid-template-rows 0fr↔1fr; внутренний
         overflow-hidden обрезает содержимое во время перехода. pt-4 на самой внутренней
         обертке дает отступ над секцией диапазона в раскрытом виде и схлопывается вместе
         со строкой, когда она скрыта (без «призрачного» отступа).
         NB: у 0fr суффикс `!` (important в Tailwind v4) — без него Tailwind выводит
         grid-rows-[1fr] после grid-rows-[0fr] в порядке исходника, поэтому базовый
         класс всегда побеждает, и переход не видит изменений. -->
      <Transition
        enter-active-class="transition-[grid-template-rows] duration-200 ease-out"
        leave-active-class="transition-[grid-template-rows] duration-200 ease-out"
        enter-from-class="grid-rows-[0fr]!"
        leave-to-class="grid-rows-[0fr]!"
      >
        <div v-if="isRangeMode" class="grid grid-rows-[1fr]">
          <div class="overflow-hidden">
            <div class="pt-4">
              <Label class="mb-2 block">Окончание работ</Label>
              <div class="flex gap-2">
                <DateTextInput
                  v-model:text="dateToText"
                  v-model:open="dateToOpen"
                  :cal="dateToCal"
                  :invalid="!!shownError('dateTo')"
                  calendar-label="Выбрать дату окончания в календаре"
                  @input="onDateToTextInput"
                  @select="onDateToSelect"
                />
                <Input
                  type="text"
                  inputmode="numeric"
                  class="h-11 w-24"
                  placeholder="ЧЧ:ММ"
                  v-model="timeToValue"
                  :aria-invalid="!!shownError('timeTo')"
                  @input="onTimeToTextInput"
                />
              </div>
              <TimePresetChips :active="timeToValue" @pick="pickTimeTo" />
              <p v-if="shownError('timeTo')" class="text-sm font-medium text-destructive mt-1">
                {{ shownError('timeTo') }}
              </p>
              <p v-if="shownError('dateTo')" class="text-sm font-medium text-destructive mt-1">
                {{ shownError('dateTo') }}
              </p>
            </div>
          </div>
        </div>
      </Transition>
    </CardContent>
  </Card>
</template>
