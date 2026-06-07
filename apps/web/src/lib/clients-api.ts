import { z } from 'zod'
import {
  clientDeleteResponseSchema,
  clientMutationResponseSchema,
  clientsListResponseSchema,
  type Client,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiClientsId,
  getApiClients,
  patchApiClientsId,
  postApiClients,
} from './generated/clients/clients'

export type { Client }

export type ClientsApiResult = z.infer<typeof clientsListResponseSchema>
export type ClientMutationResult = z.infer<typeof clientMutationResponseSchema>
export type ClientDeleteResult = z.infer<typeof clientDeleteResponseSchema>

export interface ClientInputPayload {
  name: string
  phone: string
}

export function fetchClients(): Promise<ClientsApiResult> {
  return unwrap<ClientsApiResult>(() => getApiClients())
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
