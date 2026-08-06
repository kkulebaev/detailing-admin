import { StatusCodes } from '@detailing-admin/shared'
import { getApiBase } from './api-base'

// Custom `fetch` shim that orval calls in place of the inline `fetch()` in
// every generated endpoint. Jobs:
//   1. Prepend the env-driven API base URL when the request URL is relative.
//   2. Send the auth cookie on every request (`credentials: 'include'`).
//   3. Route a bare 401 through the registered unauthorized handler — except
//      for the auth endpoints themselves, see AUTH_EXEMPT_PATHS.
//   4. Return orval's `{ data, status, headers }` envelope without an explicit
//      type assertion at the call site — the generic narrowing happens here
//      once, behind one disable directive. The `unwrap` boundary in
//      api-client.ts performs no runtime validation, so correctness depends on
//      the OpenAPI spec and the route's response actually matching the types.

// Resolved once at module load; see getApiBase for the dev/prod rationale.
const apiBase = getApiBase()

export interface OrvalEnvelope<T> {
  data: T
  status: number
  headers: Headers
}

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

// Registered lazily by main.ts, not imported here directly: auth-api.ts (and
// everything that calls it) sits below this module, while the store/router
// that need to react to a 401 sit above it — a static import in either
// direction would cycle.
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler
}

// `/login` shows its own "wrong password" message rather than bouncing to
// itself; `/me` 401s for every anonymous visitor on first load, which is
// normal, not a session expiring (treating it as one would redirect-loop);
// `/logout` clears the cookie by definition.
const AUTH_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/me', '/api/auth/logout']

export async function orvalFetch<T extends OrvalEnvelope<unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${apiBase}${url}`
  const res = await fetch(fullUrl, { ...init, credentials: 'include' })
  if (res.status === StatusCodes.UNAUTHORIZED && !AUTH_EXEMPT_PATHS.includes(url.split('?')[0])) {
    unauthorizedHandler?.()
  }
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
