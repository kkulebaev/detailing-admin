import type { BookingRow, BookingsListResponse } from '@detailing-admin/shared'
import { unwrap } from './api-client'
import { getApiBookings } from './generated/bookings/bookings'
import type { GetApiBookingsParams } from './generated/model'

export type { BookingRow, BookingsListResponse, GetApiBookingsParams }

export function fetchBookings(
  params: GetApiBookingsParams,
): Promise<BookingsListResponse> {
  return unwrap<BookingsListResponse>(() => getApiBookings(params))
}
