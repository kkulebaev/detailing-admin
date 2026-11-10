// Структурный тип намеренно: на сервере сюда идут сырые строки БД, а больше ничего не нужно.
interface SummarySource {
  readiness: string
  service: string
  dateFrom: string
}

// Визит — это запись «Выдана» (то же правило, что и в серверной статистике клиента),
// поэтому самой свежей строки недостаточно: она может быть будущей или отменённой.
// История приходит отсортированной от новых к старым.
export function lastDeliveredService(bookings: readonly SummarySource[]): string | null {
  const row = bookings.find((b) => b.readiness === 'Выдана')
  return row?.service.trim() || null
}

export interface MissedBookings {
  cancelled: number
  noShow: number
  /** ISO `YYYY-MM-DD` самой свежей отменённой или пропущенной записи. */
  lastDate: string
}

// И отмена, и неявка — повод записывать клиента только по предоплате.
// «Перенос» — нет: клиент запись сохранил, просто сдвинул её.
export function missedBookings(bookings: readonly SummarySource[]): MissedBookings | null {
  const missed = bookings.filter((b) => b.readiness === 'Отмена' || b.readiness === 'Не приехал')
  const newest = missed[0]
  if (!newest) return null
  return {
    cancelled: missed.filter((b) => b.readiness === 'Отмена').length,
    noShow: missed.filter((b) => b.readiness === 'Не приехал').length,
    lastDate: newest.dateFrom,
  }
}
