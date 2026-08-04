import { z } from 'zod'
import { READINESS } from './enums.js'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

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
  // Omitted (undefined) for non-admin roles — amounts are admin-only. Present
  // for admins.
  amount: z.number().int().optional(),
  amountFormula: z.string().nullable().optional(),
  dateFrom: z.string(),
  dateTo: z.string().nullable(),
  timeFrom: z.string(),
  timeTo: z.string().nullable(),
  // Narrowed to the READINESS enum (or '' for «нет статуса») so the wire type —
  // and the orval-generated client — carry a concrete union, not a bare string.
  // The DB column is free text, but no route runtime-validates the response, so
  // this is a type-level narrowing only.
  readiness: z.enum(READINESS).or(z.literal('')),
  master: z.array(z.string()),
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

export const bookingMutationOkSchema = z.object({ ok: z.literal(true), booking: bookingRowSchema })

export const bookingMutationResponseSchema = z.union([
  bookingMutationOkSchema,
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingMutationResponse = z.infer<typeof bookingMutationResponseSchema>

export const bookingDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingDeleteResponse = z.infer<typeof bookingDeleteResponseSchema>

// Body for the quick inline readiness change (PATCH /api/bookings/{id}/readiness).
export const bookingReadinessInputSchema = z.object({
  readiness: z.enum(READINESS).or(z.literal('')),
})

export type BookingReadinessInput = z.infer<typeof bookingReadinessInputSchema>
