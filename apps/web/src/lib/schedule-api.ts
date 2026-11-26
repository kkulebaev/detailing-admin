import { z } from 'zod'
import {
  scheduleBookingsResponseSchema,
  scheduleDayResponseSchema,
  scheduleListResponseSchema,
  studioHoursResponseSchema,
  closedDaysResponseSchema,
  closedDayMutationResponseSchema,
  type ClosedDaysInput,
  type ClosedDaysQuery,
  type MasterSchedule,
  type ScheduleBooking,
  type StudioDay,
  type StudioHoursInput,
  type ScheduleQuery,
  type ScheduleUpdateInput,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiScheduleClosedDaysDate,
  getApiSchedule,
  getApiScheduleBookings,
  getApiScheduleClosedDays,
  postApiScheduleClosedDays,
  getApiScheduleStudioHours,
  patchApiSchedule,
  putApiScheduleStudioHours,
} from './generated/schedule/schedule'

export type { MasterSchedule, ScheduleBooking, StudioDay }

export type ScheduleListResult = z.infer<typeof scheduleListResponseSchema>
export type ScheduleBookingsResult = z.infer<typeof scheduleBookingsResponseSchema>
export type ScheduleDayResult = z.infer<typeof scheduleDayResponseSchema>
export type StudioHoursResult = z.infer<typeof studioHoursResponseSchema>
export type ClosedDaysResult = z.infer<typeof closedDaysResponseSchema>
export type ClosedDayMutationResult = z.infer<typeof closedDayMutationResponseSchema>

export function fetchSchedule(range: ScheduleQuery): Promise<ScheduleListResult> {
  return unwrap<ScheduleListResult>(() => getApiSchedule(range))
}

export function fetchScheduleBookings(range: ScheduleQuery): Promise<ScheduleBookingsResult> {
  return unwrap<ScheduleBookingsResult>(() => getApiScheduleBookings(range))
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

export function fetchClosedDays(range: ClosedDaysQuery): Promise<ClosedDaysResult> {
  return unwrap<ClosedDaysResult>(() => getApiScheduleClosedDays(range))
}

export function addClosedDays(range: ClosedDaysInput): Promise<ClosedDayMutationResult> {
  return unwrap<ClosedDayMutationResult>(() => postApiScheduleClosedDays(range))
}

export function removeClosedDay(date: string): Promise<ClosedDayMutationResult> {
  return unwrap<ClosedDayMutationResult>(() => deleteApiScheduleClosedDaysDate(date))
}
