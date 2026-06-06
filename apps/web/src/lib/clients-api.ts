import { z } from 'zod'
import {
  clientDeleteResponseSchema,
  clientMutationResponseSchema,
  clientsListResponseSchema,
  type Client,
} from '@detailing-admin/shared'
import { parseResponse } from './api-client'
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
  return parseResponse(() => getApiClients(), clientsListResponseSchema)
}

export function createClient(payload: ClientInputPayload): Promise<ClientMutationResult> {
  return parseResponse(() => postApiClients(payload), clientMutationResponseSchema)
}

export function updateClient(
  id: string,
  payload: ClientInputPayload,
): Promise<ClientMutationResult> {
  return parseResponse(() => patchApiClientsId(id, payload), clientMutationResponseSchema)
}

export function deleteClient(id: string): Promise<ClientDeleteResult> {
  return parseResponse(() => deleteApiClientsId(id), clientDeleteResponseSchema)
}
