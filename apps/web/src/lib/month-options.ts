import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'

export const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

export interface MonthOption {
  value: string
  label: string
}

// Скользящее окно `YYYY-MM`: от `ahead` месяцев вперёд до `back`
// месяцев назад, новые первыми. Общее для фильтра записей и выбора месяца
// на странице зарплат, чтобы оба предлагали одинаковый набор месяцев с подписями ru-RU.
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

// "2026-01" → "январь 2026", для фраз «за …». Все названия месяцев в русском
// мужского рода, поэтому винительный падеж пишется как именительный, и убрать нужно
// только заглавную букву — посреди предложения она выглядит опечаткой.
export function formatMonthAccusative(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return month
  return `${MONTH_NAMES[m - 1]!.toLowerCase()} ${y}`
}

// Текущий месяц как `YYYY-MM` — выбор по умолчанию на странице зарплат.
export function currentMonthKey(): string {
  const t = today(getLocalTimeZone())
  return `${t.year}-${String(t.month).padStart(2, '0')}`
}
