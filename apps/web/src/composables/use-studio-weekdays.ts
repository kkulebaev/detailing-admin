import { computed } from 'vue'
import { useStudioHoursQuery } from '@/lib/queries'

export const STUDIO_CLOSED_SUFFIX = ', студия закрыта'

export function useStudioWeekdays() {
  const { data } = useStudioHoursQuery()

  const studioDays = computed(() => (data.value?.ok ? data.value.days : []))

  const openWeekdays = computed(() => {
    const r = data.value
    return r?.ok && r.days.length > 0 ? new Set(r.days.map((d) => d.weekday)) : null
  })

  // Штриховка — только по заданному режиму: суббота и воскресенье «по умолчанию»
  // не значат, что студия закрыта.
  function isStudioClosed(weekday: number): boolean {
    return openWeekdays.value !== null && !openWeekdays.value.has(weekday)
  }

  // Для подсветки названий дней: пока режим не задан — суббота и воскресенье.
  function isClosedWeekday(weekday: number): boolean {
    return openWeekdays.value ? !openWeekdays.value.has(weekday) : weekday >= 5
  }

  return { data, studioDays, openWeekdays, isStudioClosed, isClosedWeekday }
}
