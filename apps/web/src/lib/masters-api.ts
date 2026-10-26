import { z } from 'zod'
import {
  accountsListResponseSchema,
  masterDeleteResponseSchema,
  masterMutationResponseSchema,
  masterReorderResponseSchema,
  masterUpdateResponseSchema,
  mastersListResponseSchema,
  type Account,
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
import { getApiUsers } from './generated/users/users'

export type { Account, Master }

export type MastersApiResult = z.infer<typeof mastersListResponseSchema>
export type MasterMutationResult = z.infer<typeof masterMutationResponseSchema>
export type MasterUpdateResult = z.infer<typeof masterUpdateResponseSchema>
export type MasterDeleteResult = z.infer<typeof masterDeleteResponseSchema>
export type MasterReorderResult = z.infer<typeof masterReorderResponseSchema>
export type AccountsApiResult = z.infer<typeof accountsListResponseSchema>

export interface MasterInputPayload {
  name: string
  canBeResponsible: boolean
  paidSalary: boolean
  telegramId: string | null
  userId: string | null
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

// Accounts a master can be linked to — they log hours as that master.
export function fetchAccounts(): Promise<AccountsApiResult> {
  return unwrap<AccountsApiResult>(() => getApiUsers())
}
