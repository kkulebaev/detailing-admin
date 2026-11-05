import { z } from 'zod'
import {
  clientDeleteResponseSchema,
  clientDetailResponseSchema,
  clientLookupResponseSchema,
  clientMutationResponseSchema,
  clientsListResponseSchema,
  type Car,
  type Client,
  type ClientLookupMatch,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiClientsId,
  getApiClients,
  getApiClientsId,
  getApiClientsLookup,
  patchApiClientsId,
  postApiClients,
} from './generated/clients/clients'
import type { GetApiClientsParams } from './generated/model'

export type { Car, Client, ClientLookupMatch, GetApiClientsParams }

export type ClientsApiResult = z.infer<typeof clientsListResponseSchema>
export type ClientMutationResult = z.infer<typeof clientMutationResponseSchema>
export type ClientDeleteResult = z.infer<typeof clientDeleteResponseSchema>
export type ClientDetailResult = z.infer<typeof clientDetailResponseSchema>
export type ClientLookupResult = z.infer<typeof clientLookupResponseSchema>

export interface ClientInputPayload {
  name: string
  phone: string
  cars: { makeModel: string; plate: string }[]
}

export function fetchClients(params: GetApiClientsParams): Promise<ClientsApiResult> {
  return unwrap<ClientsApiResult>(() => getApiClients(params))
}

// Any failure (503, network) is surfaced as a thrown error by `unwrap`; an
// `ok: false` body maps to `null`, so the form just shows no match.
export async function lookupClientByPhone(e164: string): Promise<ClientLookupMatch | null> {
  const r = await unwrap<ClientLookupResult>(() => getApiClientsLookup({ phone: e164 }))
  return r.ok ? r.match : null
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
