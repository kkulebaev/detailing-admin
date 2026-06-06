// Custom `fetch` shim that orval calls in place of the inline `fetch()` in
// every generated endpoint. Two jobs:
//   1. Prepend the env-driven API base URL when the request URL is relative.
//   2. Return orval's `{ data, status, headers }` envelope without an explicit
//      type assertion at the call site — the generic narrowing happens here
//      once, behind one disable directive, and `parseResponse` re-validates the
//      body via Zod before any consumer sees it.

const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL
const apiBase =
  typeof envBase === 'string' && envBase.length > 0
    ? envBase
    : import.meta.env.DEV
      ? ''
      : PROD_API_FALLBACK

export interface OrvalEnvelope<T> {
  data: T
  status: number
  headers: Headers
}

export async function orvalFetch<T extends OrvalEnvelope<unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${apiBase}${url}`
  const res = await fetch(fullUrl, init)
  const body = [204, 205, 304].includes(res.status) ? null : await res.text()
  const data: unknown = body ? JSON.parse(body) : {}
  const envelope: OrvalEnvelope<unknown> = { data, status: res.status, headers: res.headers }
  // The boundary `parseResponse` in api-client.ts re-validates `data` against a
  // Zod schema, so trusting the generic narrowing here is safe.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return envelope as T
}
