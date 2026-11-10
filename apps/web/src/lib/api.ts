import type { Booking, BookingApiResult } from '@detailing-admin/shared'
import { unwrap } from './api-client'
import { postApiBookings } from './generated/bookings/bookings'

export function submitBooking(payload: Booking, idempotencyKey: string): Promise<BookingApiResult> {
  // Idempotency-Key описан в OpenAPI-спеке, но orval не выносит его
  // в аргумент функции (для этого нужен `headers: true` в конфиге и переопределение
  // валидатора заголовков под текущую формулировку на проводе). Поэтому он едет в
  // `options.headers` — формат на проводе тот же.
  return unwrap<BookingApiResult>(() =>
    postApiBookings(payload, { headers: { 'Idempotency-Key': idempotencyKey } }),
  )
}
