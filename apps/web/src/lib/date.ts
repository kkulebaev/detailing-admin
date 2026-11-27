import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'

// Форматирует дату календаря reka-ui в формат `DD.MM.YYYY`, который ожидает
// API, — общий для всех страниц с выбором даты (записи, рабочие часы,
// аналитика), чтобы преобразование не переписывали в каждом компоненте.
export function calToDdmmyyyy(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

// Даты из БД приходят в ISO `YYYY-MM-DD`; везде, где данные соотносятся с листом,
// показываем DD.MM.YYYY. Общее для таблицы записей и ее диалога с деталями.
export function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export function isoToCal(iso: string): DateValue | undefined {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  try {
    return new CalendarDate(y, m, d)
  } catch {
    return undefined
  }
}

// Разбирает только полную строку: поле даты печатают посимвольно, и `01.12.202`
// не должен превращаться в 202 год.
export function parseDdmmyyyyToCal(text: string): DateValue | null {
  const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return null
  try {
    return new CalendarDate(year, month, day)
  } catch {
    return null
  }
}
