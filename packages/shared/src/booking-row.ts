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

// ── Analytics (GET /api/analytics/overview) ────────────────────────────────
// Wire contract for the admin-only analytics page. Every numeric field is a
// plain `number`: the API coerces the string aggregates postgres-js returns
// (SUM/COUNT come back as strings) with Number() before the response is built —
// the declared `number` type is what the web client does arithmetic on (avgCheck,
// Δ%, repeatRate, chart math), so a string operand would silently corrupt it.

export const analyticsGranularitySchema = z.enum(['day', 'week', 'month'])

export type AnalyticsGranularity = z.infer<typeof analyticsGranularitySchema>

// One point of the zero-filled revenue series. `revenue` counts only «Выдана»
// bookings; `count` is the volume (all statuses) in the bucket — deliberately
// different denominators (see the API's db layer).
export const analyticsSeriesPointSchema = z.object({
  bucket: z.string(),
  revenue: z.number(),
  count: z.number(),
})

export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>

// A top-client row. The grouping is restricted to «Выдана» rows, so a client with no
// delivered cars in the period never appears (and a no-delivery period yields an empty top).
export const analyticsTopClientSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  sum: z.number(),
  visits: z.number(),
})

export type AnalyticsTopClient = z.infer<typeof analyticsTopClientSchema>

export const analyticsOverviewOkSchema = z.object({
  ok: z.literal(true),
  period: z.object({
    from: z.string(),
    to: z.string(),
    granularity: analyticsGranularitySchema,
  }),
  revenue: z.object({
    total: z.number(),
    avgCheck: z.number(),
    completedCount: z.number(),
    bookingsCount: z.number(),
    delta: z.object({
      // null when the previous period earned nothing (no meaningful %).
      revenuePct: z.number().nullable(),
      prevTotal: z.number(),
    }),
    series: z.array(analyticsSeriesPointSchema),
  }),
  clients: z.object({
    newCount: z.number(),
    returningCount: z.number(),
    noClientCount: z.number(),
    // null when there are no attributable clients (empty denominator).
    repeatRate: z.number().nullable(),
    topBySum: z.array(analyticsTopClientSchema),
    topByVisits: z.array(analyticsTopClientSchema),
  }),
})

export type AnalyticsOverviewOk = z.infer<typeof analyticsOverviewOkSchema>

export const analyticsOverviewResponseSchema = z.union([
  analyticsOverviewOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type AnalyticsOverviewResponse = z.infer<typeof analyticsOverviewResponseSchema>
