import { computed, ref, shallowRef } from 'vue'
import { today, getLocalTimeZone } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import { calToDdmmyyyy, parseDdmmyyyyToCal } from '@/lib/date'
import { maskDateText, maskTimeText, writeMasked } from '@/lib/input-masks'

// Часы работы детейлинга: 10:00–18:30 слотами по 30 минут.
export const TIME_PRESETS = [
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
] as const

export type DateField = 'dateFrom' | 'dateTo' | 'time' | 'timeTo'

function sameDay(a: DateValue, b: DateValue): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

// Дата и время записи. Текст полей живет в собственных ref, чтобы в них можно было
// печатать с маской; календарь — лишь второй способ ввода, который пишет в те же ref.
// В поля формы значения уходят через `setField`.
export function useBookingDates(setField: (field: DateField, value: string | undefined) => void) {
  const todayVal = today(getLocalTimeZone())
  // shallowRef сохраняет #private-поле CalendarDate (UnwrapRef из Vue его срезает)
  const dateFromCal = shallowRef<DateValue>(todayVal)
  const dateToCal = shallowRef<DateValue>(todayVal)
  const dateFromText = ref(calToDdmmyyyy(todayVal))
  const dateToText = ref(calToDdmmyyyy(todayVal))
  const timeValue = ref('')
  const timeToValue = ref('')
  // Когда включен, появляется вторая строка «Окончание работ».
  const isRangeMode = ref(false)
  const dateFromOpen = ref(false)
  const dateToOpen = ref(false)

  function shiftedDate(days: number): DateValue {
    return todayVal.add({ days })
  }

  // Какой из чипов «Сегодня/Завтра/Послезавтра» горит; null — ни один.
  const activeDayOffset = computed<number | null>(() => {
    if (isRangeMode.value) return null
    const hit = [0, 1, 2].find((d) => sameDay(dateFromCal.value, shiftedDate(d)))
    return hit ?? null
  })

  function clearRangeEnd() {
    setField('dateTo', undefined)
    setField('timeTo', undefined)
    timeToValue.value = ''
  }

  function pickDay(days: number) {
    const d = shiftedDate(days)
    isRangeMode.value = false
    dateFromCal.value = d
    dateFromText.value = calToDdmmyyyy(d)
    setField('dateFrom', calToDdmmyyyy(d))
    clearRangeEnd()
  }

  function toggleRangeMode() {
    if (isRangeMode.value) {
      isRangeMode.value = false
      clearRangeEnd()
      return
    }
    isRangeMode.value = true
    // Копируем dateFrom в dateTo, чтобы пользователь мог поправить только конец, а
    // наполовину заполненный диапазон никогда не попадал в поля формы.
    dateToCal.value = dateFromCal.value
    dateToText.value = dateFromText.value
    setField('dateTo', dateFromText.value)
  }

  function pickTime(t: string) {
    timeValue.value = t
    setField('time', t)
  }

  function pickTimeTo(t: string) {
    timeToValue.value = t
    setField('timeTo', t)
  }

  function onDateFromTextInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    const masked = maskDateText(target.value)
    if (writeMasked(target, masked)) dateFromText.value = masked
    setField('dateFrom', masked)
    const parsed = parseDdmmyyyyToCal(masked)
    if (parsed) dateFromCal.value = parsed
  }

  function onDateToTextInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    const masked = maskDateText(target.value)
    if (writeMasked(target, masked)) dateToText.value = masked
    setField('dateTo', masked)
    const parsed = parseDdmmyyyyToCal(masked)
    if (parsed) dateToCal.value = parsed
  }

  function onTimeTextInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    const masked = maskTimeText(target.value)
    if (writeMasked(target, masked)) timeValue.value = masked
    setField('time', masked)
  }

  function onTimeToTextInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    const masked = maskTimeText(target.value)
    if (writeMasked(target, masked)) timeToValue.value = masked
    setField('timeTo', masked)
  }

  function onDateFromSelect(date: DateValue | undefined) {
    if (!date) return
    dateFromCal.value = date
    const str = calToDdmmyyyy(date)
    dateFromText.value = str
    setField('dateFrom', str)
    dateFromOpen.value = false
  }

  function onDateToSelect(date: DateValue | undefined) {
    if (!date) return
    dateToCal.value = date
    const str = calToDdmmyyyy(date)
    dateToText.value = str
    setField('dateTo', str)
    dateToOpen.value = false
  }

  // Поля формы сбрасывает resetForm у владельца формы; здесь — только свое состояние.
  function reset(date: DateValue) {
    timeValue.value = ''
    timeToValue.value = ''
    dateFromText.value = calToDdmmyyyy(date)
    dateToText.value = calToDdmmyyyy(date)
    dateFromCal.value = date
    dateToCal.value = date
    isRangeMode.value = false
  }

  return {
    todayVal,
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
    reset,
  }
}

export type BookingDates = ReturnType<typeof useBookingDates>
