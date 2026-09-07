import { z } from 'zod'
import {
  salariesListResponseSchema,
  salaryEntriesListResponseSchema,
  rateMutationResponseSchema,
  workHoursMutationResponseSchema,
  workHoursDeleteResponseSchema,
  payoutMutationResponseSchema,
  payoutDeleteResponseSchema,
  type SalaryRow,
  type WorkHours,
  type Payout,
  type SalaryEntry,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiSalariesHoursId,
  deleteApiSalariesPayoutsId,
  getApiSalaries,
  getApiSalariesEntries,
  patchApiSalariesHoursId,
  patchApiSalariesPayoutsId,
  patchApiSalariesRates,
  postApiSalariesHours,
  postApiSalariesPayouts,
} from './generated/salaries/salaries'

export type { SalaryRow, WorkHours, Payout, SalaryEntry }

export type SalariesApiResult = z.infer<typeof salariesListResponseSchema>
export type SalaryEntriesListResult = z.infer<typeof salaryEntriesListResponseSchema>
export type RateMutationResult = z.infer<typeof rateMutationResponseSchema>
export type WorkHoursMutationResult = z.infer<typeof workHoursMutationResponseSchema>
export type WorkHoursDeleteResult = z.infer<typeof workHoursDeleteResponseSchema>
export type PayoutMutationResult = z.infer<typeof payoutMutationResponseSchema>
export type PayoutDeleteResult = z.infer<typeof payoutDeleteResponseSchema>

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

export interface PayoutCreatePayload {
  masterId: number
  payoutDate: string
  amount: number
  note?: string
}

export interface PayoutUpdatePayload {
  payoutDate?: string
  amount?: number
  note?: string
}

export function fetchSalaries(month: string): Promise<SalariesApiResult> {
  return unwrap<SalariesApiResult>(() => getApiSalaries({ month }))
}

export function setMasterRate(payload: RatePayload): Promise<RateMutationResult> {
  return unwrap<RateMutationResult>(() => patchApiSalariesRates(payload))
}

// One request per master: hours and payouts come back already merged into a
// single chronological feed, so the detail view never merges anything itself.
export function fetchSalaryEntries(
  masterId: number,
  month: string,
): Promise<SalaryEntriesListResult> {
  return unwrap<SalaryEntriesListResult>(() =>
    getApiSalariesEntries({ masterId: String(masterId), month }),
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

export function createPayout(payload: PayoutCreatePayload): Promise<PayoutMutationResult> {
  return unwrap<PayoutMutationResult>(() => postApiSalariesPayouts(payload))
}

export function updatePayout(
  id: number,
  payload: PayoutUpdatePayload,
): Promise<PayoutMutationResult> {
  return unwrap<PayoutMutationResult>(() =>
    patchApiSalariesPayoutsId(String(id), payload),
  )
}

export function deletePayout(id: number): Promise<PayoutDeleteResult> {
  return unwrap<PayoutDeleteResult>(() => deleteApiSalariesPayoutsId(String(id)))
}
