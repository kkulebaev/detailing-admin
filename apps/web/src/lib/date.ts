import type { DateValue } from 'reka-ui'

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
