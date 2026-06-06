import {
  bookingApiResultSchema,
  type Booking,
  type BookingApiResult,
} from '@detailing-admin/shared'
import { parseResponse } from './api-client'
import { postApiBookings } from './generated/bookings/bookings'

export function submitBooking(
  payload: Booking,
  idempotencyKey: string,
): Promise<BookingApiResult> {
  // Idempotency-Key is documented in the OpenAPI spec but orval doesn't lift
  // it to a function argument (we'd need `headers: true` in the config and a
  // header-validator override to match the existing wire wording). It rides on
  // `options.headers` instead — same wire format.
  return parseResponse(
    () => postApiBookings(payload, { headers: { 'Idempotency-Key': idempotencyKey } }),
    bookingApiResultSchema,
  )
}
