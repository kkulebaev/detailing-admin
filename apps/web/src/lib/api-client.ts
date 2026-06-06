import { hc } from 'hono/client'
import type { AppType } from '@detailing-admin/api/server'

// VITE_API_BASE_URL is the primary source. The hardcoded fallback exists
// because Railway's first build for this service ran before the env var was
// set, so the bundle ended up with an empty base and fetch resolved to the
// same-origin web container (which serves only the SPA, not /api). In dev
// the Vite proxy makes `/api/...` work with an empty base too.
const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
const apiBase = envBase || (import.meta.env.DEV ? '' : PROD_API_FALLBACK)

// `hc<AppType>` produces a fully typed RPC proxy. Access mirrors the URL tree:
//   client.api.clients.$get()
//   client.api.clients[':id'].$patch({ param: { id }, json: payload })
//   client.api.bookings.$post({ json, header: { 'Idempotency-Key': key } })
// Inputs are inferred from the route's `zValidator` schemas, response unions
// from each `c.json(...)` site in the handler.
export const apiClient = hc<AppType>(apiBase)
