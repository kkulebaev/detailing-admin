import { StatusCodes } from '@detailing-admin/shared'

// Custom `fetch` shim that orval calls in place of the inline `fetch()` in
// every generated endpoint. Two jobs:
//   1. Prepend the env-driven API base URL when the request URL is relative.
//   2. Return orval's `{ data, status, headers }` envelope without an explicit
//      type assertion at the call site — the generic narrowing happens here
//      once, behind one disable directive. The `unwrap` boundary in
//      api-client.ts performs no runtime validation, so correctness depends on
//      the OpenAPI spec and the route's response actually matching the types.

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
  const bodylessStatuses: number[] = [
    StatusCodes.NO_CONTENT,
    StatusCodes.RESET_CONTENT,
    StatusCodes.NOT_MODIFIED,
  ]
  const body = bodylessStatuses.includes(res.status) ? null : await res.text()
  const data: unknown = body ? JSON.parse(body) : {}
  const envelope: OrvalEnvelope<unknown> = { data, status: res.status, headers: res.headers }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return envelope as T
}
