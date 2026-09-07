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

const payoutNote = z.string().max(500)
// Whole signed rubles. min/max are emitted into OpenAPI as minimum/maximum and
// double as a guard against an extra digit slipping in. The non-zero rule lives
// in a refine (which never reaches the spec) and is mirrored by a DB CHECK.
const payoutAmount = z
  .number()
  .int('Сумма должна быть целым числом рублей')
  .min(-10_000_000, 'Слишком большая сумма')
  .max(10_000_000, 'Слишком большая сумма')
  .refine((v) => v !== 0, 'Сумма не может быть нулевой')

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

// One-off payments unrelated to hours worked: bonuses, reimbursements and
// (negative) deductions. No rate is involved — the amount stands on its own.
export const payoutInputSchema = z.object({
  masterId: z.number().int().positive(),
  payoutDate: isoDate,
  amount: payoutAmount,
  note: payoutNote.optional(),
})

export type PayoutInput = z.infer<typeof payoutInputSchema>

// The master never changes on edit — same contract as work hours.
export const payoutUpdateSchema = z.object({
  payoutDate: isoDate.optional(),
  amount: payoutAmount.optional(),
  note: payoutNote.optional(),
})

export type PayoutUpdate = z.infer<typeof payoutUpdateSchema>

// ---- Response object schemas ----

export const salaryRowSchema = z.object({
  masterId: z.number().int(),
  masterName: z.string(),
  // null when the master has no rate row yet — distinct from a 0 rate.
  hourlyRate: z.number().int().nullable(),
  totalMinutes: z.number().int(),
  // Pay for hours: round(Σ(minutes × rate_snapshot) / 60), one rounding per
  // month. Named `hoursSalary`, not `salary`, because it is no longer the whole
  // salary — only its hourly part.
  hoursSalary: z.number().int(),
  // Sum of the month's one-off payments; 0 means "no rows" as well as "rows
  // cancelled each other out" — the single "no rows for the period" convention.
  payoutsTotal: z.number().int(),
  total: z.number().int(),
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

// A stored payouts record. No rate snapshot by construction.
export const payoutSchema = z.object({
  id: z.number().int(),
  masterId: z.number().int(),
  payoutDate: z.string(),
  amount: z.number().int(),
  note: z.string(),
  createdAt: z.string(),
})

export type Payout = z.infer<typeof payoutSchema>

// ---- Detail feed ----

// Hours and payouts are stored and written separately, but read as one sorted
// feed: the master's detail view shouldn't know how many tables it came from.
// Feed entries keep the field names of their source entity (workDate /
// payoutDate) rather than gaining a third name.
export const hoursEntrySchema = workHoursSchema.extend({ kind: z.literal('hours') })
export const payoutEntrySchema = payoutSchema.extend({ kind: z.literal('payout') })
export const salaryEntrySchema = z.discriminatedUnion('kind', [hoursEntrySchema, payoutEntrySchema])

export type HoursEntry = z.infer<typeof hoursEntrySchema>
export type PayoutEntry = z.infer<typeof payoutEntrySchema>
export type SalaryEntry = z.infer<typeof salaryEntrySchema>

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

export const salaryEntriesListResponseSchema = z.union([
  z.object({ ok: z.literal(true), entries: z.array(salaryEntrySchema) }),
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

// No no_rate variant: a payout needs no rate (§0.3).
export const payoutMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), payout: payoutSchema }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const payoutDeleteResponseSchema = z.union([
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

// A feed entry's date: workDate for hours, payoutDate for payouts.
export function salaryEntryDate(e: SalaryEntry): string {
  return e.kind === 'hours' ? e.workDate : e.payoutDate
}

// Chronological within the month; on the same day hours come before payouts,
// then by id — the order is deterministic, so rows don't jump on a refetch.
// Merging happens here rather than in SQL: a UNION ALL would need brittle column
// casts to force both shapes into one.
export function mergeSalaryEntries(hours: WorkHours[], payouts: Payout[]): SalaryEntry[] {
  const entries: SalaryEntry[] = [
    ...hours.map((h) => ({ ...h, kind: 'hours' as const })),
    ...payouts.map((p) => ({ ...p, kind: 'payout' as const })),
  ]
  return entries.sort((a, b) => {
    const byDate = salaryEntryDate(a).localeCompare(salaryEntryDate(b))
    if (byDate !== 0) return byDate
    if (a.kind !== b.kind) return a.kind === 'hours' ? -1 : 1
    return a.id - b.id
  })
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
