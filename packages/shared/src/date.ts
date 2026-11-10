export function parseDdmmyyyy(s: string): Date {
  const parts = s.split('.')
  if (parts.length !== 3) throw new Error('Invalid DD.MM.YYYY: ' + s)

  const d = parseInt(parts[0]!, 10)
  const m = parseInt(parts[1]!, 10)
  const y = parseInt(parts[2]!, 10)

  if (isNaN(d) || isNaN(m) || isNaN(y)) throw new Error('Invalid DD.MM.YYYY: ' + s)

  const date = new Date(Date.UTC(y, m - 1, d))

  // Проверка границ через обратное форматирование: если дата перекатилась, части не совпадут
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error('Invalid DD.MM.YYYY: ' + s)
  }

  return date
}

export function formatDdmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getUTCFullYear())
  return `${dd}.${mm}.${yyyy}`
}

/** Переводит валидную строку `DD.MM.YYYY` в ISO `YYYY-MM-DD`, который ждет колонка
 * Postgres типа `date`. Сначала проверяет через parseDdmmyyyy, чтобы кривой ввод
 * бросал ошибку, а не молча давал битую ISO-строку. Не зависит от часового пояса:
 * работает с частями строки, а не с Date в локальном времени. */
export function ddmmyyyyToIso(s: string): string {
  parseDdmmyyyy(s)
  const [dd, mm, yyyy] = s.split('.')
  return `${yyyy}-${mm}-${dd}`
}
