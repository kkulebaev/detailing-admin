import type { Booking, BookingApiResult } from '@detailing-admin/shared'
import { apiClient } from './api-client'

export async function submitBooking(
  payload: Booking,
  idempotencyKey: string,
): Promise<BookingApiResult> {
  // Idempotency-Key isn't behind zValidator on the route (kept as manual
  // middleware so the existing log shape + error wording stay byte-identical),
  // so it travels via the fetch `init` overrides rather than the typed input.
  const res = await apiClient.api.bookings.$post(
    { json: payload },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  )

  // If not JSON (e.g. unexpected HTML 502 from proxy), return generic internal error
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { ok: false, error: 'internal' }
  }

  return res.json() as Promise<BookingApiResult>
}
