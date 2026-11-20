import { z } from 'zod'
import {
  scheduleDayResponseSchema,
  scheduleListResponseSchema,
  type MasterSchedule,
  type ScheduleQuery,
  type ScheduleUpdateInput,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import { getApiSchedule, patchApiSchedule } from './generated/schedule/schedule'

export type { MasterSchedule }

export type ScheduleListResult = z.infer<typeof scheduleListResponseSchema>
export type ScheduleDayResult = z.infer<typeof scheduleDayResponseSchema>

export function fetchSchedule(range: ScheduleQuery): Promise<ScheduleListResult> {
  return unwrap<ScheduleListResult>(() => getApiSchedule(range))
}

export function saveSchedule(payload: ScheduleUpdateInput): Promise<ScheduleDayResult> {
  return unwrap<ScheduleDayResult>(() => patchApiSchedule(payload))
}
