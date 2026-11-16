import { computed, type Ref } from 'vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import {
  SCHEDULE_MAX_RANGE_DAYS,
  findDaysOff,
  scheduleMonthsRange,
  scheduleRangeDays,
} from '@detailing-admin/shared'
import { useMastersQuery, useScheduleQuery } from '@/lib/queries'

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}`
}

// Только предупреждает: график — ориентир, и запись на выходной мастера допустима
// (подмена, переработка). Ошибка или недоступная БД просто дают пустой список, потому
// что форма записи не должна зависеть от Postgres.
export function useDaysOffWarning(
  dateFrom: Ref<string | null>,
  dateTo: Ref<string | null>,
  masterNames: Ref<readonly string[]>,
  // В окне правки старые записи созданы до графика: предупреждение о прошлом там
  // горело бы почти всегда, и его перестали бы замечать.
  options: { skipPast?: boolean } = {},
) {
  const range = computed(() => {
    const from = dateFrom.value
    if (!from || masterNames.value.length === 0) return null
    const to = dateTo.value && dateTo.value > from ? dateTo.value : from
    const months = scheduleMonthsRange(from, to)
    return scheduleRangeDays(months.from, months.to) <= SCHEDULE_MAX_RANGE_DAYS ? months : null
  })

  const { data: scheduleData } = useScheduleQuery(range)
  const { data: mastersData } = useMastersQuery()

  return computed<string[]>(() => {
    const from = dateFrom.value
    const data = scheduleData.value
    const masters = mastersData.value?.ok ? mastersData.value.masters : null
    // placeholderData держит прошлый диапазон, пока грузится новый: сверяться с ним
    // значит объявить выходными все дни нового месяца.
    const current = range.value
    if (!current || !from || !data?.ok || !masters) return []
    if (data.from !== current.from || data.to !== current.to) return []
    const schedule = data.schedule
    const todayIso = today(getLocalTimeZone()).toString()

    const to = dateTo.value && dateTo.value > from ? dateTo.value : from
    const nameById = new Map(
      masters.filter((m) => masterNames.value.includes(m.name)).map((m) => [m.id, m.name]),
    )
    return findDaysOff(schedule, [...nameById.keys()], from, to).flatMap(({ masterId, dates }) => {
      const shown = options.skipPast ? dates.filter((d) => d >= todayIso) : dates
      if (shown.length === 0) return []
      return [`${nameById.get(masterId) ?? ''} — ${shown.map(shortDate).join(', ')}`]
    })
  })
}
