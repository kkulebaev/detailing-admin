import type {
  BookingRow,
  BookingsListResponse,
  BookingMutationResponse,
  BookingDeleteResponse,
  Readiness,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiBookingsId,
  getApiBookings,
  patchApiBookingsId,
  patchApiBookingsIdReadiness,
} from './generated/bookings/bookings'
import type { GetApiBookingsParams, PatchApiBookingsIdBody } from './generated/model'

export type {
  BookingRow,
  BookingsListResponse,
  GetApiBookingsParams,
  PatchApiBookingsIdBody,
}

export function fetchBookings(
  params: GetApiBookingsParams,
): Promise<BookingsListResponse> {
  return unwrap<BookingsListResponse>(() => getApiBookings(params))
}

export function updateBooking(
  id: string,
  payload: PatchApiBookingsIdBody,
): Promise<BookingMutationResponse> {
  return unwrap<BookingMutationResponse>(() => patchApiBookingsId(id, payload))
}

export function deleteBooking(id: string): Promise<BookingDeleteResponse> {
  return unwrap<BookingDeleteResponse>(() => deleteApiBookingsId(id))
}

export function updateBookingReadiness(
  id: string,
  readiness: Readiness | '',
): Promise<BookingMutationResponse> {
  return unwrap<BookingMutationResponse>(() => patchApiBookingsIdReadiness(id, { readiness }))
}
