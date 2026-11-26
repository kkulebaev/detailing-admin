import { computed, type Ref } from 'vue'
import { isoWeekday, type ScheduleQuery } from '@detailing-admin/shared'
import { useClosedDaysQuery, useStudioHoursQuery } from '@/lib/queries'

export const STUDIO_CLOSED_SUFFIX = ', студия закрыта'

// `range` — период на экране: разовые выходные грузятся по нему, режим недели целиком.
export function useStudioWeekdays(range: Ref<ScheduleQuery | null>) {
  const { data } = useStudioHoursQuery()
  const { data: closedData } = useClosedDaysQuery(range)

  const studioDays = computed(() => (data.value?.ok ? data.value.days : []))

  const openWeekdays = computed(() => {
    const r = data.value
    return r?.ok && r.days.length > 0 ? new Set(r.days.map((d) => d.weekday)) : null
  })

  // placeholderData держит прошлый период, пока грузится новый, — его даты сюда
  // просто не попадут, поэтому сверять `from` не нужно.
  const closedDates = computed(() => (closedData.value?.ok ? closedData.value.dates : []))
  const closedSet = computed(() => new Set(closedDates.value))

  // Штриховка — только по заданному режиму: суббота и воскресенье «по умолчанию»
  // не значат, что студия закрыта.
  function isStudioClosed(weekday: number): boolean {
    return openWeekdays.value !== null && !openWeekdays.value.has(weekday)
  }

  function isOneOffClosed(iso: string): boolean {
    return closedSet.value.has(iso)
  }

  function isDateClosed(iso: string): boolean {
    return isOneOffClosed(iso) || isStudioClosed(isoWeekday(iso))
  }

  // Для подсветки названий дней недели: пока режим не задан — суббота и воскресенье.
  function isClosedWeekday(weekday: number): boolean {
    return openWeekdays.value ? !openWeekdays.value.has(weekday) : weekday >= 5
  }

  const hasClosedDays = computed(() => openWeekdays.value !== null || closedDates.value.length > 0)

  return {
    data,
    studioDays,
    openWeekdays,
    closedDates,
    hasClosedDays,
    isStudioClosed,
    isOneOffClosed,
    isDateClosed,
    isClosedWeekday,
  }
}
