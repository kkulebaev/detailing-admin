import { z } from 'zod'
import {
  masterDeleteResponseSchema,
  masterMutationResponseSchema,
  masterReorderResponseSchema,
  masterUpdateResponseSchema,
  mastersListResponseSchema,
  type Master,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiMastersId,
  getApiMasters,
  patchApiMastersId,
  patchApiMastersReorder,
  postApiMasters,
} from './generated/masters/masters'

export type { Master }

export type MastersApiResult = z.infer<typeof mastersListResponseSchema>
export type MasterMutationResult = z.infer<typeof masterMutationResponseSchema>
export type MasterUpdateResult = z.infer<typeof masterUpdateResponseSchema>
export type MasterDeleteResult = z.infer<typeof masterDeleteResponseSchema>
export type MasterReorderResult = z.infer<typeof masterReorderResponseSchema>

export interface MasterInputPayload {
  name: string
  canBeResponsible: boolean
  telegramId: string | null
}

export function fetchMasters(): Promise<MastersApiResult> {
  return unwrap<MastersApiResult>(() => getApiMasters())
}

export function createMaster(payload: MasterInputPayload): Promise<MasterMutationResult> {
  return unwrap<MasterMutationResult>(() => postApiMasters(payload))
}

export function updateMaster(
  id: number,
  payload: MasterInputPayload,
): Promise<MasterUpdateResult> {
  return unwrap<MasterUpdateResult>(() => patchApiMastersId(String(id), payload))
}

export function deleteMaster(id: number): Promise<MasterDeleteResult> {
  return unwrap<MasterDeleteResult>(() => deleteApiMastersId(String(id)))
}

export function reorderMasters(ids: number[]): Promise<MasterReorderResult> {
  return unwrap<MasterReorderResult>(() => patchApiMastersReorder({ ids }))
}
