import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'

export const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const

export interface MonthOption {
  value: string
  label: string
}

// Rolling `YYYY-MM` window: `ahead` months into the future down to `back`
// months past, newest first. Shared by the bookings filter and the salaries
// month picker so both offer the same set of months with ru-RU labels.
export function buildMonthOptions(ahead = 1, back = 12): MonthOption[] {
  const anchor = today(getLocalTimeZone())
  const first = new CalendarDate(anchor.year, anchor.month, 1)
  const opts: MonthOption[] = []
  for (let i = ahead; i >= -back; i--) {
    const d = first.add({ months: i })
    opts.push({
      value: `${d.year}-${String(d.month).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.month - 1]} ${d.year}`,
    })
  }
  return opts
}

// The current month as `YYYY-MM` — the salaries page's default selection.
export function currentMonthKey(): string {
  const t = today(getLocalTimeZone())
  return `${t.year}-${String(t.month).padStart(2, '0')}`
}
