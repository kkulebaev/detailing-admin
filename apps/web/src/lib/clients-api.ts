import { z } from 'zod'
import {
  clientDeleteResponseSchema,
  clientMutationResponseSchema,
  clientsListResponseSchema,
  type Client,
} from '@detailing-admin/shared'
import { apiClient, parseResponse } from './api-client'

export type { Client }

export type ClientsApiResult = z.infer<typeof clientsListResponseSchema>
export type ClientMutationResult = z.infer<typeof clientMutationResponseSchema>
export type ClientDeleteResult = z.infer<typeof clientDeleteResponseSchema>

export interface ClientInputPayload {
  name: string
  phone: string
}

export function fetchClients(): Promise<ClientsApiResult> {
  return parseResponse(() => apiClient.api.clients.$get(), clientsListResponseSchema)
}

export function createClient(payload: ClientInputPayload): Promise<ClientMutationResult> {
  return parseResponse(
    () => apiClient.api.clients.$post({ json: payload }),
    clientMutationResponseSchema,
  )
}

export function updateClient(
  id: string,
  payload: ClientInputPayload,
): Promise<ClientMutationResult> {
  return parseResponse(
    () => apiClient.api.clients[':id'].$patch({ param: { id }, json: payload }),
    clientMutationResponseSchema,
  )
}

export function deleteClient(id: string): Promise<ClientDeleteResult> {
  return parseResponse(
    () => apiClient.api.clients[':id'].$delete({ param: { id } }),
    clientDeleteResponseSchema,
  )
}
