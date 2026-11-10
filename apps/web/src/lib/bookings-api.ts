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
import type {
  GetApiBookingsParams,
  GetApiBookingsSort,
  PatchApiBookingsIdBody,
} from './generated/model'

export type {
  BookingRow,
  BookingsListResponse,
  GetApiBookingsParams,
  GetApiBookingsSort,
  PatchApiBookingsIdBody,
}

export function fetchBookings(params: GetApiBookingsParams): Promise<BookingsListResponse> {
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

// Ключи пагинации отбрасываются: экспорт возвращает весь отфильтрованный набор, а не страницу.
const EXPORT_OMIT = new Set(['limit', 'offset'])

// Строит URL CSV-экспорта из ТЕХ ЖЕ параметров фильтра, что и список, поэтому
// скачанный файл всегда совпадает с тем, что на экране. Query сериализуется ровно как в
// сгенерированном orval построителе URL (URLSearchParams, undefined пропускаются), чтобы
// не расходиться с запросом списка. Этот роут живёт вне OpenAPI/orval (CSV, а не
// JSON), поэтому downloadFile обращается к нему raw-fetch'ем по URL.
export function bookingsExportUrl(params: GetApiBookingsParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (EXPORT_OMIT.has(key) || value === undefined) continue
    qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `/api/bookings/export?${s}` : '/api/bookings/export'
}
