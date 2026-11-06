import { page } from 'vitest/browser'

const DAY_LABEL = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// Matches the cell's full-date aria-label rather than its number, because padding
// cells of the neighbouring months repeat the numbers.
export function calendarDay(day: number) {
  const now = new Date()
  const name = DAY_LABEL.format(new Date(now.getFullYear(), now.getMonth(), day))
  return page.getByRole('button', { name })
}
