import { page } from 'vitest/browser'

const DAY_LABEL = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// Ищет ячейку по aria-label с полной датой, а не по числу, потому что ячейки-заполнители
// соседних месяцев повторяют числа.
export function calendarDay(day: number) {
  const now = new Date()
  const name = DAY_LABEL.format(new Date(now.getFullYear(), now.getMonth(), day))
  return page.getByRole('button', { name })
}
