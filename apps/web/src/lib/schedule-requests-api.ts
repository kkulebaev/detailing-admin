import { z } from 'zod'
import {
  myScheduleRequestsResponseSchema,
  scheduleRequestActionResponseSchema,
  scheduleRequestSubmitResponseSchema,
  scheduleRequestsResponseSchema,
  type ScheduleRequest,
  type ScheduleRequestInput,
  type ScheduleRequestRejectInput,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiMeScheduleRequestsId,
  getApiMeScheduleRequests,
  postApiMeScheduleRequests,
} from './generated/me/me'
import {
  getApiScheduleRequests,
  postApiScheduleRequestsIdApprove,
  postApiScheduleRequestsIdReject,
} from './generated/schedule-requests/schedule-requests'

export type { ScheduleRequest }

export type MyScheduleRequestsResult = z.infer<typeof myScheduleRequestsResponseSchema>
export type ScheduleRequestSubmitResult = z.infer<typeof scheduleRequestSubmitResponseSchema>
export type ScheduleRequestsResult = z.infer<typeof scheduleRequestsResponseSchema>
export type ScheduleRequestActionResult = z.infer<typeof scheduleRequestActionResponseSchema>

export function fetchMyScheduleRequests(): Promise<MyScheduleRequestsResult> {
  return unwrap<MyScheduleRequestsResult>(() => getApiMeScheduleRequests())
}

export function submitScheduleRequest(
  payload: ScheduleRequestInput,
): Promise<ScheduleRequestSubmitResult> {
  return unwrap<ScheduleRequestSubmitResult>(() => postApiMeScheduleRequests(payload))
}

export function withdrawScheduleRequest(id: number): Promise<ScheduleRequestActionResult> {
  return unwrap<ScheduleRequestActionResult>(() => deleteApiMeScheduleRequestsId(String(id)))
}

export function fetchPendingScheduleRequests(): Promise<ScheduleRequestsResult> {
  return unwrap<ScheduleRequestsResult>(() => getApiScheduleRequests())
}

export function approveScheduleRequest(id: number): Promise<ScheduleRequestActionResult> {
  return unwrap<ScheduleRequestActionResult>(() => postApiScheduleRequestsIdApprove(String(id)))
}

export function rejectScheduleRequest(
  id: number,
  payload: ScheduleRequestRejectInput,
): Promise<ScheduleRequestActionResult> {
  return unwrap<ScheduleRequestActionResult>(() =>
    postApiScheduleRequestsIdReject(String(id), payload),
  )
}
