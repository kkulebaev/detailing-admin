import { z } from 'zod'
import {
  salariesListResponseSchema,
  workHoursListResponseSchema,
  rateMutationResponseSchema,
  workHoursMutationResponseSchema,
  workHoursDeleteResponseSchema,
  type SalaryRow,
  type WorkHours,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiSalariesHoursId,
  getApiSalaries,
  getApiSalariesHours,
  patchApiSalariesHoursId,
  patchApiSalariesRates,
  postApiSalariesHours,
} from './generated/salaries/salaries'

export type { SalaryRow, WorkHours }

export type SalariesApiResult = z.infer<typeof salariesListResponseSchema>
export type WorkHoursListResult = z.infer<typeof workHoursListResponseSchema>
export type RateMutationResult = z.infer<typeof rateMutationResponseSchema>
export type WorkHoursMutationResult = z.infer<typeof workHoursMutationResponseSchema>
export type WorkHoursDeleteResult = z.infer<typeof workHoursDeleteResponseSchema>

export interface RatePayload {
  masterId: number
  hourlyRate: number
}

export interface WorkHoursCreatePayload {
  masterId: number
  workDate: string
  hours: number
  note?: string
}

export interface WorkHoursUpdatePayload {
  workDate?: string
  hours?: number
  note?: string
}

export function fetchSalaries(month: string): Promise<SalariesApiResult> {
  return unwrap<SalariesApiResult>(() => getApiSalaries({ month }))
}

export function setMasterRate(payload: RatePayload): Promise<RateMutationResult> {
  return unwrap<RateMutationResult>(() => patchApiSalariesRates(payload))
}

export function fetchWorkHours(
  masterId: number,
  month: string,
): Promise<WorkHoursListResult> {
  return unwrap<WorkHoursListResult>(() =>
    getApiSalariesHours({ masterId: String(masterId), month }),
  )
}

export function createWorkHours(
  payload: WorkHoursCreatePayload,
): Promise<WorkHoursMutationResult> {
  return unwrap<WorkHoursMutationResult>(() => postApiSalariesHours(payload))
}

export function updateWorkHours(
  id: number,
  payload: WorkHoursUpdatePayload,
): Promise<WorkHoursMutationResult> {
  return unwrap<WorkHoursMutationResult>(() =>
    patchApiSalariesHoursId(String(id), payload),
  )
}

export function deleteWorkHours(id: number): Promise<WorkHoursDeleteResult> {
  return unwrap<WorkHoursDeleteResult>(() => deleteApiSalariesHoursId(String(id)))
}
