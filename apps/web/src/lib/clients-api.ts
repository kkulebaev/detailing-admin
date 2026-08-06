import { z } from 'zod'
import {
  clientDeleteResponseSchema,
  clientDetailResponseSchema,
  clientMutationResponseSchema,
  clientsListResponseSchema,
  type Car,
  type Client,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiClientsId,
  getApiClients,
  getApiClientsId,
  patchApiClientsId,
  postApiClients,
} from './generated/clients/clients'
import type { GetApiClientsParams } from './generated/model'

export type { Car, Client, GetApiClientsParams }

export type ClientsApiResult = z.infer<typeof clientsListResponseSchema>
export type ClientMutationResult = z.infer<typeof clientMutationResponseSchema>
export type ClientDeleteResult = z.infer<typeof clientDeleteResponseSchema>
export type ClientDetailResult = z.infer<typeof clientDetailResponseSchema>

export interface ClientInputPayload {
  name: string
  phone: string
  cars: { makeModel: string; plate: string }[]
}

export function fetchClients(params: GetApiClientsParams): Promise<ClientsApiResult> {
  return unwrap<ClientsApiResult>(() => getApiClients(params))
}

// Point-lookup of a client by a full E.164 phone, reusing the list endpoint.
// `q` runs through an `ilike` over both name and phone, so a partial or name
// match could slip in — the exact `phone === e164` guard lives HERE (and only
// here) so callers get a clean `Client | null`. Any failure (503, network) is
// surfaced as a thrown error by `unwrap`; an `ok: false` body maps to `null`.
export async function lookupClientByPhone(e164: string): Promise<Client | null> {
  const r = await fetchClients({ q: e164, limit: 1 })
  return r.ok && r.clients[0]?.phone === e164 ? r.clients[0] : null
}

export function createClient(payload: ClientInputPayload): Promise<ClientMutationResult> {
  return unwrap<ClientMutationResult>(() => postApiClients(payload))
}

export function updateClient(
  id: string,
  payload: ClientInputPayload,
): Promise<ClientMutationResult> {
  return unwrap<ClientMutationResult>(() => patchApiClientsId(id, payload))
}

export function deleteClient(id: string): Promise<ClientDeleteResult> {
  return unwrap<ClientDeleteResult>(() => deleteApiClientsId(id))
}

export function fetchClientDetail(id: string): Promise<ClientDetailResult> {
  return unwrap<ClientDetailResult>(() => getApiClientsId(id))
}

// Paging keys are dropped: export returns the whole filtered set, not a page.
const EXPORT_OMIT = new Set(['limit', 'offset'])

// Builds the CSV export URL from the SAME filter/sort params the list uses, so
// the download mirrors what's on screen. Serialized like orval's generated URL
// builder (URLSearchParams, skip undefined). This route lives outside
// OpenAPI/orval (CSV, not JSON) and is fetched by URL via downloadFile.
export function clientsExportUrl(params: GetApiClientsParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (EXPORT_OMIT.has(key) || value === undefined || value === null) continue
    qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `/api/clients/export?${s}` : '/api/clients/export'
}
