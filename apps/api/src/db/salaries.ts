import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { monthRange, salaryFromMinutesRateSum, type SalaryRow } from '@detailing-admin/shared'
import { getDb } from './client.js'
import {
  masterRates,
  masters,
  payouts,
  workHours,
  type MasterRate,
  type PayoutRow,
  type WorkHoursRow,
} from './schema.js'

export type SalaryMutationError = 'no_rate' | 'not_found' | 'master_not_found'

export class SalaryError extends Error {
  constructor(public readonly code: SalaryMutationError) {
    super(code)
    this.name = 'SalaryError'
  }
}

export async function getMasterRates(): Promise<MasterRate[]> {
  const db = getDb()
  return db.select().from(masterRates)
}

export async function setMasterRate(masterId: number, hourlyRate: number): Promise<void> {
  const db = getDb()
  // Probe the master first: the FK would otherwise reject an unknown masterId
  // with an opaque 500; refuse explicitly so the route can answer 404.
  const [master] = await db
    .select({ id: masters.id })
    .from(masters)
    .where(eq(masters.id, masterId))
    .limit(1)
  if (!master) throw new SalaryError('master_not_found')

  await db
    .insert(masterRates)
    .values({ masterId, hourlyRate })
    .onConflictDoUpdate({
      target: masterRates.masterId,
      set: { hourlyRate, updatedAt: new Date() },
    })
}

export async function listSalaries(month: string): Promise<SalaryRow[]> {
  const db = getDb()
  const { start, end } = monthRange(month)

  // Aggregate work_hours for the month in a subquery grouped by master, so the
  // LEFT JOIN to masters/master_rates doesn't fan the rate out across hour rows.
  // Both sums are exact integers — SUM(minutes) and SUM(minutes × rate_snapshot,
  // in ₽·min). Division to whole rubles and the single rounding happen in JS
  // (salaryFromMinutesRateSum), deliberately NOT in SQL: keeping SQL to integer
  // sums sidesteps Postgres' int/int truncation entirely and lets the same
  // pure helper back both the header total and the detail view (no drift).
  const agg = db
    .select({
      masterId: workHours.masterId,
      totalMinutes: sql<string>`sum(${workHours.minutes})`.as('total_minutes'),
      minutesRateSum:
        sql<string>`sum(${workHours.minutes} * ${workHours.rateSnapshot})`.as('minutes_rate_sum'),
    })
    .from(workHours)
    .where(and(gte(workHours.workDate, start), lt(workHours.workDate, end)))
    .groupBy(workHours.masterId)
    .as('agg')

  // Second month aggregate, same shape as `agg`: one row per master, so joining
  // it alongside cannot fan out (both GROUP BY masterId, master_rates is PK'd on
  // masterId). Summing in SQL keeps the signed rubles integer end to end.
  const payoutAgg = db
    .select({
      masterId: payouts.masterId,
      payoutsSum: sql<string>`sum(${payouts.amount})`.as('payouts_sum'),
    })
    .from(payouts)
    .where(and(gte(payouts.payoutDate, start), lt(payouts.payoutDate, end)))
    .groupBy(payouts.masterId)
    .as('payout_agg')

  const rows = await db
    .select({
      masterId: masters.id,
      masterName: masters.name,
      hourlyRate: masterRates.hourlyRate,
      totalMinutes: agg.totalMinutes,
      minutesRateSum: agg.minutesRateSum,
      payoutsSum: payoutAgg.payoutsSum,
    })
    .from(masters)
    .leftJoin(masterRates, eq(masterRates.masterId, masters.id))
    .leftJoin(agg, eq(agg.masterId, masters.id))
    .leftJoin(payoutAgg, eq(payoutAgg.masterId, masters.id))
    .where(eq(masters.paidSalary, true))
    .orderBy(masters.position, masters.id)

  // postgres-js returns SUM() as a string (numeric/bigint); coerce with Number.
  // A master with no hours has null agg columns → 0 minutes, 0 salary. A master
  // with no rate has null hourlyRate (kept null, not coerced to 0). A null
  // payouts_sum collapses to 0 — "no rows" and "rows cancelled out" are the same
  // state here by design.
  return rows.map((r) => {
    const hoursSalary = salaryFromMinutesRateSum(Number(r.minutesRateSum ?? 0))
    const payoutsTotal = Number(r.payoutsSum ?? 0)
    return {
      masterId: r.masterId,
      masterName: r.masterName,
      hourlyRate: r.hourlyRate ?? null,
      totalMinutes: Number(r.totalMinutes ?? 0),
      hoursSalary,
      payoutsTotal,
      total: hoursSalary + payoutsTotal,
    }
  })
}

// Both halves of one master's month in a single call. Two SELECTs rather than a
// UNION ALL (which would need brittle casts to force both shapes into one); the
// merge into a single sorted feed is mergeSalaryEntries in shared, applied by the
// route. Two round-trips to Postgres, but one HTTP request per expanded master.
export async function listMasterEntries(
  masterId: number,
  month: string,
): Promise<{ hours: WorkHoursRow[]; payouts: PayoutRow[] }> {
  const db = getDb()
  const { start, end } = monthRange(month)
  const [hoursRows, payoutRows] = await Promise.all([
    db
      .select()
      .from(workHours)
      .where(
        and(
          eq(workHours.masterId, masterId),
          gte(workHours.workDate, start),
          lt(workHours.workDate, end),
        ),
      )
      .orderBy(workHours.workDate, workHours.id),
    db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.masterId, masterId),
          gte(payouts.payoutDate, start),
          lt(payouts.payoutDate, end),
        ),
      )
      .orderBy(payouts.payoutDate, payouts.id),
  ])
  return { hours: hoursRows, payouts: payoutRows }
}

export interface CreateWorkHoursInput {
  masterId: number
  workDate: string
  minutes: number
  note: string
}

export async function createWorkHours(input: CreateWorkHoursInput): Promise<WorkHoursRow> {
  const db = getDb()
  // Snapshot the master's CURRENT rate. No rate row → refuse (route → 400): a
  // record without a rate can't be priced, and the invariant is "no rate = no row".
  const [rate] = await db
    .select({ hourlyRate: masterRates.hourlyRate })
    .from(masterRates)
    .where(eq(masterRates.masterId, input.masterId))
    .limit(1)
  if (!rate) throw new SalaryError('no_rate')

  const [row] = await db
    .insert(workHours)
    .values({
      masterId: input.masterId,
      workDate: input.workDate,
      minutes: input.minutes,
      rateSnapshot: rate.hourlyRate,
      note: input.note,
    })
    .returning()
  return row
}

export interface WorkHoursPatch {
  workDate?: string
  minutes?: number
  note?: string
}

export async function updateWorkHours(id: number, patch: WorkHoursPatch): Promise<WorkHoursRow> {
  const db = getDb()

  // Editing never re-snapshots the rate — only day/minutes/note change. An empty
  // patch is a no-op: drizzle's .set({}) throws, so return the current row.
  const set: WorkHoursPatch = {}
  if (patch.workDate !== undefined) set.workDate = patch.workDate
  if (patch.minutes !== undefined) set.minutes = patch.minutes
  if (patch.note !== undefined) set.note = patch.note

  if (Object.keys(set).length === 0) {
    const [existing] = await db.select().from(workHours).where(eq(workHours.id, id)).limit(1)
    if (!existing) throw new SalaryError('not_found')
    return existing
  }

  const [row] = await db.update(workHours).set(set).where(eq(workHours.id, id)).returning()
  if (!row) throw new SalaryError('not_found')
  return row
}

export async function deleteWorkHours(id: number): Promise<void> {
  const db = getDb()
  const result = await db
    .delete(workHours)
    .where(eq(workHours.id, id))
    .returning({ id: workHours.id })
  if (result.length === 0) throw new SalaryError('not_found')
}

export interface CreatePayoutInput {
  masterId: number
  payoutDate: string
  amount: number
  note: string
}

export async function createPayout(input: CreatePayoutInput): Promise<PayoutRow> {
  const db = getDb()
  // Probe the master first: the FK would otherwise reject an unknown masterId
  // with an opaque 500. master_rates is deliberately NOT read — a payout is
  // self-contained, so a master without a rate can still receive one.
  const [master] = await db
    .select({ id: masters.id })
    .from(masters)
    .where(eq(masters.id, input.masterId))
    .limit(1)
  if (!master) throw new SalaryError('master_not_found')

  const [row] = await db
    .insert(payouts)
    .values({
      masterId: input.masterId,
      payoutDate: input.payoutDate,
      amount: input.amount,
      note: input.note,
    })
    .returning()
  return row
}

export interface PayoutPatch {
  payoutDate?: string
  amount?: number
  note?: string
}

export async function updatePayout(id: number, patch: PayoutPatch): Promise<PayoutRow> {
  const db = getDb()

  // The master never changes on edit. An empty patch is a no-op: drizzle's
  // .set({}) throws, so return the current row.
  const set: PayoutPatch = {}
  if (patch.payoutDate !== undefined) set.payoutDate = patch.payoutDate
  if (patch.amount !== undefined) set.amount = patch.amount
  if (patch.note !== undefined) set.note = patch.note

  if (Object.keys(set).length === 0) {
    const [existing] = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1)
    if (!existing) throw new SalaryError('not_found')
    return existing
  }

  const [row] = await db.update(payouts).set(set).where(eq(payouts.id, id)).returning()
  if (!row) throw new SalaryError('not_found')
  return row
}

export async function deletePayout(id: number): Promise<void> {
  const db = getDb()
  const result = await db.delete(payouts).where(eq(payouts.id, id)).returning({ id: payouts.id })
  if (result.length === 0) throw new SalaryError('not_found')
}
