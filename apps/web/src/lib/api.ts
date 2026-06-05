import type { Booking, BookingApiResult } from '@detailing-admin/shared'

// VITE_API_BASE_URL is the primary source. The hardcoded fallback exists
// because Railway's first build for this service ran before the env var was
// set, so the bundle ended up with an empty base and fetch resolved to the
// same-origin web container (which serves only the SPA, not /api). In dev
// the Vite proxy makes `/api/...` work with an empty base too.
const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
const apiBase = envBase || (import.meta.env.DEV ? '' : PROD_API_FALLBACK)

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
