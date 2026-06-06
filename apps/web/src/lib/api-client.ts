import { hc } from 'hono/client'
import type { ClientResponse } from 'hono/client'
import { z } from 'zod'
import type { AppType } from '@detailing-admin/api/server'

// VITE_API_BASE_URL is the primary source. The hardcoded fallback exists
// because Railway's first build for this service ran before the env var was
// set, so the bundle ended up with an empty base and fetch resolved to the
// same-origin web container (which serves only the SPA, not /api). In dev
// the Vite proxy makes `/api/...` work with an empty base too.
const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL
const apiBase =
  typeof envBase === 'string' && envBase.length > 0
    ? envBase
    : import.meta.env.DEV
      ? ''
      : PROD_API_FALLBACK

// `hc<AppType>` produces a fully typed RPC proxy. Access mirrors the URL tree:
//   apiClient.api.clients.$get()
//   apiClient.api.clients[':id'].$patch({ param: { id }, json: payload })
//   apiClient.api.bookings.$post({ json, header: { 'Idempotency-Key': key } })
export const apiClient = hc<AppType>(apiBase)

/**
 * Boundary parser. Every domain response schema unions an
 * `{ ok: false, error: 'internal' }` variant, so the failure fallback
 * round-trips through `schema.parse(...)` instead of needing a type assertion
 * to widen back into `T`.
 */
export async function parseResponse<T>(
  call: () => Promise<ClientResponse<unknown>>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const res = await call()
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const raw: unknown = await res.json()
      const parsed = schema.safeParse(raw)
      if (parsed.success) return parsed.data
    }
  } catch {
    // network error, non-JSON body, schema mismatch — fall through to internal
  }
  return schema.parse({ ok: false, error: 'internal' })
}
