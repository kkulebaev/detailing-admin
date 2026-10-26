import type { BookingRow } from '@detailing-admin/shared'

// A visit is a «Выдана» booking — the same rule as the server-side client stats
// — so the newest row is not enough: it may be a future or cancelled booking.
// History arrives sorted newest-first.
export function lastDeliveredService(bookings: BookingRow[]): string | null {
  const row = bookings.find((b) => b.readiness === 'Выдана')
  return row?.service.trim() || null
}

export interface MissedBookings {
  cancelled: number
  noShow: number
  /** ISO `YYYY-MM-DD` of the newest cancelled or missed booking. */
  lastDate: string
}

// Both a cancellation and a no-show are grounds to book the client only against
// a prepayment. «Перенос» is not: the client kept the booking, just moved it.
export function missedBookings(bookings: BookingRow[]): MissedBookings | null {
  const missed = bookings.filter((b) => b.readiness === 'Отмена' || b.readiness === 'Не приехал')
  const newest = missed[0]
  if (!newest) return null
  return {
    cancelled: missed.filter((b) => b.readiness === 'Отмена').length,
    noShow: missed.filter((b) => b.readiness === 'Не приехал').length,
    lastDate: newest.dateFrom,
  }
}
