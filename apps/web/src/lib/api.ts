import type { Booking, BookingApiResult } from '@detailing-admin/shared'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export async function submitBooking(
  payload: Booking,
  idempotencyKey: string,
): Promise<BookingApiResult> {
  const res = await fetch(`${apiBase}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })

  // If not JSON (e.g. unexpected HTML 502 from proxy), return generic internal error
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { ok: false, error: 'internal' }
  }

  return res.json() as Promise<BookingApiResult>
}
