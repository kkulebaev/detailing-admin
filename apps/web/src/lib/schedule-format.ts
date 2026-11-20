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
