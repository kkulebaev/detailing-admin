import { z } from 'zod'
import {
  scheduleDayResponseSchema,
  scheduleListResponseSchema,
  studioHoursResponseSchema,
  type MasterSchedule,
  type StudioDay,
  type StudioHoursInput,
  type ScheduleQuery,
  type ScheduleUpdateInput,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  getApiSchedule,
  getApiScheduleStudioHours,
  patchApiSchedule,
  putApiScheduleStudioHours,
} from './generated/schedule/schedule'

export type { MasterSchedule, StudioDay }

export type ScheduleListResult = z.infer<typeof scheduleListResponseSchema>
export type ScheduleDayResult = z.infer<typeof scheduleDayResponseSchema>
export type StudioHoursResult = z.infer<typeof studioHoursResponseSchema>

export function fetchSchedule(range: ScheduleQuery): Promise<ScheduleListResult> {
  return unwrap<ScheduleListResult>(() => getApiSchedule(range))
}

export function saveSchedule(payload: ScheduleUpdateInput): Promise<ScheduleDayResult> {
  return unwrap<ScheduleDayResult>(() => patchApiSchedule(payload))
}

export function fetchStudioHours(): Promise<StudioHoursResult> {
  return unwrap<StudioHoursResult>(() => getApiScheduleStudioHours())
}

export function saveStudioHours(payload: StudioHoursInput): Promise<StudioHoursResult> {
  return unwrap<StudioHoursResult>(() => putApiScheduleStudioHours(payload))
}
