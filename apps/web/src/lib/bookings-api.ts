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

// Paging keys are dropped: export returns the whole filtered set, not a page.
const EXPORT_OMIT = new Set(['limit', 'offset'])

// Builds the CSV export URL from the SAME filter params the list uses, so the
// download always mirrors what's on screen. The query is serialized exactly like
// orval's generated URL builder (URLSearchParams, skip undefined) to stay in
// step with the list request. This route lives outside OpenAPI/orval (CSV, not
// JSON), so downloadFile hits it with a raw fetch by URL.
export function bookingsExportUrl(params: GetApiBookingsParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (EXPORT_OMIT.has(key) || value === undefined) continue
    qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `/api/bookings/export?${s}` : '/api/bookings/export'
}
