import type {
  BookingRow,
  BookingsListResponse,
  BookingMutationResponse,
  BookingDeleteResponse,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiBookingsId,
  getApiBookings,
  patchApiBookingsId,
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
