import { z } from 'zod'
import {
  mySalaryResponseSchema,
  myWorkHoursDeleteResponseSchema,
  myWorkHoursMutationResponseSchema,
  type MySalaryOk,
  type SelfWorkHoursInput,
  type WorkHoursUpdate,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiMeHoursId,
  getApiMeSalary,
  patchApiMeHoursId,
  postApiMeHours,
} from './generated/me/me'

export type { MySalaryOk }

export type MySalaryResult = z.infer<typeof mySalaryResponseSchema>
export type MyWorkHoursMutationResult = z.infer<typeof myWorkHoursMutationResponseSchema>
export type MyWorkHoursDeleteResult = z.infer<typeof myWorkHoursDeleteResponseSchema>

export function fetchMySalary(month: string): Promise<MySalaryResult> {
  return unwrap<MySalaryResult>(() => getApiMeSalary({ month }))
}

export function createMyWorkHours(payload: SelfWorkHoursInput): Promise<MyWorkHoursMutationResult> {
  return unwrap<MyWorkHoursMutationResult>(() => postApiMeHours(payload))
}

export function updateMyWorkHours(
  id: number,
  payload: WorkHoursUpdate,
): Promise<MyWorkHoursMutationResult> {
  return unwrap<MyWorkHoursMutationResult>(() => patchApiMeHoursId(String(id), payload))
}

export function deleteMyWorkHours(id: number): Promise<MyWorkHoursDeleteResult> {
  return unwrap<MyWorkHoursDeleteResult>(() => deleteApiMeHoursId(String(id)))
}
