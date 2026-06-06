import { z } from 'zod'

// Shared response building blocks. Each route's response schema unions a
// success variant with these — kept here so the wire-level error shapes stay
// in one place and the web boundary can `safeParse` instead of casting.

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
})

export const validationErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  issues: z.array(validationIssueSchema),
})

export const internalErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('internal'),
})

export const notFoundErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('not_found'),
})

export const sheetsErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('sheets'),
  code: z.number().optional(),
  message: z.string(),
})

export const unavailableErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('unavailable'),
  reason: z.union([z.literal('headers_mismatch'), z.literal('not_configured')]),
  column_index: z.number().optional(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  message: z.string().optional(),
})

// DB-only unavailable (no `reason: 'headers_mismatch'`; that's a Sheets-side concern).
export const dbUnavailableErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('unavailable'),
  reason: z.literal('not_configured').optional(),
  message: z.string(),
})

const bookingSuccessSchema = z.object({
  ok: z.literal(true),
  idempotent: z.boolean(),
  updatedRange: z.string(),
  updatedRow: z.number(),
})

export const bookingApiResultSchema = z.union([
  bookingSuccessSchema,
  validationErrorSchema,
  sheetsErrorSchema,
  internalErrorSchema,
  unavailableErrorSchema,
])

export type ValidationIssue = z.infer<typeof validationIssueSchema>
export type BookingApiResult = z.infer<typeof bookingApiResultSchema>

// Legacy generic alias — kept so older import sites still compile. Prefer the
// per-route schemas defined alongside their domain (e.g. clientMutationResponseSchema).
export type ApiResult<T> =
  | ({ ok: true } & T)
  | z.infer<typeof validationErrorSchema>
  | z.infer<typeof sheetsErrorSchema>
  | z.infer<typeof internalErrorSchema>
  | z.infer<typeof unavailableErrorSchema>
