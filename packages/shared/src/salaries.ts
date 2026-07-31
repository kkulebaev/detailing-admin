import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Strict ISO calendar date (YYYY-MM-DD). The regex pins the shape; the refine
// rejects impossible dates (e.g. 2026-02-31) by round-tripping through Date and
// checking the parts survived — same trick as parseDdmmyyyy.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате ГГГГ-ММ-ДД')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y!, m! - 1, d!))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d
  }, 'Недопустимая дата')

// "YYYY-MM". The regex forbids month 00 and 13+; the half-open range
// [YYYY-MM-01, next month) is derived by monthRange() below.
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц должен быть в формате ГГГГ-ММ')

const workHoursNote = z.string().max(500)
// 15-minute granularity keeps the minutes↔hours round-trip exact in the UI.
const workHours = z.number().positive().max(24).multipleOf(0.25)

export const rateInputSchema = z.object({
  masterId: z.number().int().positive(),
  // min(1): a 0 rate would silently zero out salary via a 0 snapshot; the
  // "no rate" state is encoded by the absence of a master_rates row, never a 0.
  hourlyRate: z.number().int().min(1),
})

export type RateInput = z.infer<typeof rateInputSchema>

export const workHoursInputSchema = z.object({
  masterId: z.number().int().positive(),
  workDate: isoDate,
  hours: workHours,
  note: workHoursNote.optional(),
})

export type WorkHoursInput = z.infer<typeof workHoursInputSchema>

// Editing a record never re-snapshots the rate, so masterId and the rate are
// absent by construction — only the day/hours/note are mutable.
export const workHoursUpdateSchema = z.object({
  workDate: isoDate.optional(),
  hours: workHours.optional(),
  note: workHoursNote.optional(),
})

export type WorkHoursUpdate = z.infer<typeof workHoursUpdateSchema>

// ---- Response object schemas ----

export const salaryRowSchema = z.object({
  masterId: z.number().int(),
  masterName: z.string(),
  // null when the master has no rate row yet — distinct from a 0 rate.
  hourlyRate: z.number().int().nullable(),
  totalMinutes: z.number().int(),
  salary: z.number().int(),
})

export type SalaryRow = z.infer<typeof salaryRowSchema>

// A stored work_hours record carrying the rate snapshot captured at insert.
// `createdAt` is an ISO datetime string after JSON serialization.
export const workHoursSchema = z.object({
  id: z.number().int(),
  masterId: z.number().int(),
  workDate: z.string(),
  minutes: z.number().int(),
  rateSnapshot: z.number().int(),
  note: z.string(),
  createdAt: z.string(),
})

export type WorkHours = z.infer<typeof workHoursSchema>

// POST /hours precondition: adding hours to a master with no rate yet. A domain
// error surfaced as a validation-flavoured response with a `reason` literal —
// same shape as masters' invalid_order (not a zod issue list).
export const workHoursNoRateSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.literal('no_rate'),
})

export const salariesListResponseSchema = z.union([
  z.object({ ok: z.literal(true), month: z.string(), rows: z.array(salaryRowSchema) }),
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workHoursListResponseSchema = z.union([
  z.object({ ok: z.literal(true), hours: z.array(workHoursSchema) }),
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const rateMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workHoursMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), hours: workHoursSchema }),
  validationErrorSchema,
  workHoursNoRateSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workHoursDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// ---- Pure helpers (unit-tested) ----

// Hours (0.25 steps in the UI) → minutes. Math.round guards against float dust
// on the multiply (e.g. 7.51 → 451, not 450).
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

export function minutesToHours(minutes: number): number {
  return minutes / 60
}

// The single-rounding primitive shared by the SQL aggregate path (db layer) and
// the row-based computeSalary below: one Math.round over Σ(minutes×rate)/60.
// minutesRateSum is an exact integer (₽·min); rounding to whole rubles happens
// here, once per month — never per row.
export function salaryFromMinutesRateSum(minutesRateSum: number): number {
  return Math.round(minutesRateSum / 60)
}

// Salary from detail rows, rounded ONCE over the month total — so header totals
// match the sum of detail components. Two 25-min rows at 100 ₽/ч must yield
// round(5000/60)=83, not round(2500/60)*2=84.
export function computeSalary(entries: Array<{ minutes: number; rate: number }>): number {
  const minutesRateSum = entries.reduce((acc, e) => acc + e.minutes * e.rate, 0)
  return salaryFromMinutesRateSum(minutesRateSum)
}

// Month "YYYY-MM" → half-open ISO date range [first day, first day of next
// month). Rolls December → next January (+1 year). Timezone-free: string parts
// only, matching the `date` column's storage.
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const nextY = m === 12 ? y! + 1 : y!
  const nextM = m === 12 ? 1 : m! + 1
  const end = `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}-01`
  return { start, end }
}
