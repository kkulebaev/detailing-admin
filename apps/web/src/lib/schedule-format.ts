import { isoWeekday, type ScheduleBooking } from '@detailing-admin/shared'
import { pluralize } from './plural'

export const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

export function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_GENITIVE[m! - 1]}`
}

// «3, 5, 7 декабря, 2 января»: месяц пишется один раз после своих чисел.
export function formatDayList(dates: readonly string[]): string {
  const groups: { month: number; days: number[] }[] = []
  for (const iso of [...dates].sort()) {
    const [, m, d] = iso.split('-').map(Number)
    const last = groups[groups.length - 1]
    if (last && last.month === m) last.days.push(d!)
    else groups.push({ month: m!, days: [d!] })
  }
  return groups.map((g) => `${g.days.join(', ')} ${MONTHS_GENITIVE[g.month - 1]}`).join(', ')
}

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatSentAt(isoTimestamp: string): string {
  return dateTime.format(new Date(isoTimestamp))
}

const WEEKDAY_LONG = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
] as const

export function weekdayName(iso: string): string {
  return WEEKDAY_LONG[isoWeekday(iso)]
}

function bookingTime(b: ScheduleBooking): string {
  return b.timeTo ? `${b.timeFrom}–${b.timeTo}` : b.timeFrom
}

function bookingLine(b: ScheduleBooking): string {
  return `${bookingTime(b)} ${b.car} — ${b.service}`
}

// title показывает записи построчно, aria-label читается одной фразой.
export function describeDayBookings(bookings: readonly ScheduleBooking[]): {
  title: string
  label: string
} {
  const n = bookings.length
  const count = `${n} ${pluralize(n, ['запись', 'записи', 'записей'])}`
  const lines = bookings.map(bookingLine)
  return { title: [count, ...lines].join('\n\n'), label: `${count}: ${lines.join('; ')}` }
}
