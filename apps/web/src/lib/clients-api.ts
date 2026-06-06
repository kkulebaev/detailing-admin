import type { ClientResponse } from 'hono/client'
import { apiClient } from './api-client'

export interface Client {
  id: string
  phone: string
  name: string
}

export type ClientsApiResult =
  | { ok: true; clients: Client[] }
  | { ok: false; error: 'unavailable'; reason: 'not_configured'; message: string }
  | { ok: false; error: 'internal' }

export interface ClientInputPayload {
  name: string
  phone: string
}

type ValidationIssue = { path: (string | number)[]; message: string }

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'validation'; issues: ValidationIssue[] }
  | { ok: false; error: 'conflict'; reason: 'duplicate_phone' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unavailable'; message: string }
  | { ok: false; error: 'internal' }

async function jsonOrNull(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null
  return res.json()
}

export async function fetchClients(): Promise<ClientsApiResult> {
  const res = await apiClient.api.clients.$get()
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { ok: false, error: 'internal' }
  }
  return res.json() as Promise<ClientsApiResult>
}

// Wraps an hc call and folds the discriminated response shape into our
// MutationResult. Errors thrown by fetch (offline, CORS) collapse to `internal`.
async function mutate<T>(
  call: () => Promise<ClientResponse<unknown>>,
  extract: (raw: any) => T,
): Promise<MutationResult<T>> {
  let res: ClientResponse<unknown>
  try {
    res = await call()
  } catch {
    return { ok: false, error: 'internal' }
  }

  const raw = (await jsonOrNull(res)) as any
  if (!raw) return { ok: false, error: 'internal' }

  if (raw.ok === true) {
    return { ok: true, data: extract(raw) }
  }
  if (raw.error === 'validation') {
    return { ok: false, error: 'validation', issues: raw.issues ?? [] }
  }
  if (raw.error === 'conflict') {
    return { ok: false, error: 'conflict', reason: raw.reason }
  }
  if (raw.error === 'not_found') {
    return { ok: false, error: 'not_found' }
  }
  if (raw.error === 'unavailable') {
    return { ok: false, error: 'unavailable', message: raw.message ?? 'База данных недоступна' }
  }
  return { ok: false, error: 'internal' }
}

export function createClient(payload: ClientInputPayload) {
  return mutate(
    () => apiClient.api.clients.$post({ json: payload }),
    (r) => r.client as Client,
  )
}

export function updateClient(id: string, payload: ClientInputPayload) {
  return mutate(
    () => apiClient.api.clients[':id'].$patch({ param: { id }, json: payload }),
    (r) => r.client as Client,
  )
}

export function deleteClient(id: string) {
  return mutate(
    () => apiClient.api.clients[':id'].$delete({ param: { id } }),
    () => undefined as void,
  )
}
