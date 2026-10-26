import type { BookingRow } from '@detailing-admin/shared'

// A visit is a «Выдана» booking — the same rule as the server-side client stats
// — so the newest row is not enough: it may be a future or cancelled booking.
// History arrives sorted newest-first.
export function lastDeliveredService(bookings: BookingRow[]): string | null {
  const row = bookings.find((b) => b.readiness === 'Выдана')
  return row?.service.trim() || null
}
