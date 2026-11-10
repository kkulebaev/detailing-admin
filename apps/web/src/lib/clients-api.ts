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

// Любой сбой (503, сеть) `unwrap` поднимает как исключение; тело
// `ok: false` превращается в `null`, и форма просто не показывает совпадения.
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

// Ключи пагинации отбрасываются: экспорт возвращает весь отфильтрованный набор, а не страницу.
const EXPORT_OMIT = new Set(['limit', 'offset'])

// Строит URL CSV-экспорта из ТЕХ ЖЕ параметров фильтра/сортировки, что и список, поэтому
// скачанный файл совпадает с тем, что на экране. Сериализуется как в сгенерированном orval
// построителе URL (URLSearchParams, undefined пропускаются). Этот роут живет вне
// OpenAPI/orval (CSV, а не JSON) и запрашивается по URL через downloadFile.
export function clientsExportUrl(params: GetApiClientsParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (EXPORT_OMIT.has(key) || value === undefined || value === null) continue
    qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `/api/clients/export?${s}` : '/api/clients/export'
}
