import { z } from 'zod'
import {
  scheduleDayResponseSchema,
  scheduleListResponseSchema,
  type MasterSchedule,
  type ScheduleDayInput,
  type ScheduleQuery,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import { getApiSchedule, patchApiSchedule } from './generated/schedule/schedule'

export type { MasterSchedule }

export type ScheduleListResult = z.infer<typeof scheduleListResponseSchema>
export type ScheduleDayResult = z.infer<typeof scheduleDayResponseSchema>

export function fetchSchedule(range: ScheduleQuery): Promise<ScheduleListResult> {
  return unwrap<ScheduleListResult>(() => getApiSchedule(range))
}

export function setScheduleDay(payload: ScheduleDayInput): Promise<ScheduleDayResult> {
  return unwrap<ScheduleDayResult>(() => patchApiSchedule(payload))
}
