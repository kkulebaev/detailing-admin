import {
  bookingApiResultSchema,
  type Booking,
  type BookingApiResult,
} from '@detailing-admin/shared'
import { apiClient, parseResponse } from './api-client'

export function submitBooking(
  payload: Booking,
  idempotencyKey: string,
): Promise<BookingApiResult> {
  // Idempotency-Key isn't behind zValidator on the route (kept as manual
  // middleware so the existing log shape + error wording stay byte-identical),
  // so it travels via the fetch `init` overrides rather than the typed input.
  return parseResponse(
    () =>
      apiClient.api.bookings.$post(
        { json: payload },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    bookingApiResultSchema,
  )
}
