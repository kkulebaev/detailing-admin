import { z } from 'zod'
import { dbUnavailableErrorSchema, internalErrorSchema, validationErrorSchema } from './api.js'

// Wire shape of a stored booking as returned by `GET /api/bookings`. Mirrors the
// `bookings` table minus the internal `idempotencyKey`. Dates are ISO strings
// (`YYYY-MM-DD`); `createdAt` is an ISO datetime after JSON serialization.
export const bookingRowSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  name: z.string(),
  phone: z.string(),
  car: z.string(),
  service: z.string(),
  note: z.string(),
  amount: z.number().int(),
  amountFormula: z.string().nullable(),
  dateFrom: z.string(),
  dateTo: z.string().nullable(),
  timeFrom: z.string(),
  timeTo: z.string().nullable(),
  readiness: z.string(),
  master: z.string(),
  responsible: z.string(),
  carClass: z.number().int(),
  sheetRow: z.number().int().nullable(),
  sheetRange: z.string().nullable(),
  createdAt: z.string(),
})

export type BookingRow = z.infer<typeof bookingRowSchema>

export const bookingsListOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(bookingRowSchema),
  total: z.number().int(),
})

export const bookingsListResponseSchema = z.union([
  bookingsListOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingsListResponse = z.infer<typeof bookingsListResponseSchema>
