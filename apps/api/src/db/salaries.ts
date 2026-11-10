import { and, eq, gte, isNotNull, lt, or, sql } from 'drizzle-orm'
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

export async function getMasterRate(masterId: number): Promise<number | null> {
  const db = getDb()
  const [row] = await db
    .select({ hourlyRate: masterRates.hourlyRate })
    .from(masterRates)
    .where(eq(masterRates.masterId, masterId))
    .limit(1)
  return row?.hourlyRate ?? null
}

export async function setMasterRate(masterId: number, hourlyRate: number): Promise<void> {
  const db = getDb()
  // Сначала проверяем мастера: иначе FK отклонил бы неизвестный masterId невнятным
  // 500; отказываем явно, чтобы маршрут мог ответить 404.
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

  // Агрегируем work_hours за месяц в подзапросе с группировкой по мастеру, чтобы
  // LEFT JOIN к masters/master_rates не размножал ставку по строкам часов.
  // Обе суммы — точные целые: SUM(minutes) и SUM(minutes × rate_snapshot,
  // в ₽·мин). Деление до целых рублей и единственное округление делаются в JS
  // (salaryFromMinutesRateSum), намеренно НЕ в SQL: целочисленные суммы в SQL
  // полностью обходят усечение int/int в Postgres, и один и тот же чистый хелпер
  // обслуживает и итог в заголовке, и детальный вид (без расхождений).
  const agg = db
    .select({
      masterId: workHours.masterId,
      totalMinutes: sql<string>`sum(${workHours.minutes})`.as('total_minutes'),
      minutesRateSum: sql<string>`sum(${workHours.minutes} * ${workHours.rateSnapshot})`.as(
        'minutes_rate_sum',
      ),
    })
    .from(workHours)
    .where(and(gte(workHours.workDate, start), lt(workHours.workDate, end)))
    .groupBy(workHours.masterId)
    .as('agg')

  // Второй месячный агрегат той же формы, что `agg`: одна строка на мастера, поэтому
  // join рядом не размножает строки (оба GROUP BY masterId, у master_rates PK по
  // masterId). Суммирование в SQL сохраняет рубли со знаком целыми от начала до конца.
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
    // Архивный мастер остаётся в любом месяце, где у него есть часы или выплаты:
    // если его убрать, скроются деньги, которые ещё должны за месяц ухода.
    .where(
      and(
        eq(masters.paidSalary, true),
        or(
          eq(masters.archived, false),
          isNotNull(agg.totalMinutes),
          isNotNull(payoutAgg.payoutsSum),
        ),
      ),
    )
    .orderBy(masters.position, masters.id)

  // postgres-js возвращает SUM() строкой (numeric/bigint); приводим через Number.
  // У мастера без часов столбцы agg равны null → 0 минут, 0 зарплаты. У мастера
  // без ставки hourlyRate равен null (так и остаётся, не приводится к 0). null в
  // payouts_sum превращается в 0 — «нет строк» и «строки взаимно погасились» здесь
  // по задумке одно и то же состояние.
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

// Обе половины месяца одного мастера за один вызов. Два SELECT, а не UNION ALL
// (там понадобились бы хрупкие приведения, чтобы свести обе формы в одну); слияние в
// одну отсортированную ленту делает mergeSalaryEntries из shared, вызываемый маршрутом.
// Два обращения к Postgres, но один HTTP-запрос на раскрытого мастера.
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
  // Фиксируем ТЕКУЩУЮ ставку мастера. Нет строки ставки → отказ (маршрут → 400):
  // запись без ставки нельзя оценить, а инвариант — «нет ставки = нет строки».
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

export async function getWorkHoursById(id: number): Promise<WorkHoursRow | undefined> {
  const db = getDb()
  const [row] = await db.select().from(workHours).where(eq(workHours.id, id)).limit(1)
  return row
}

export interface WorkHoursPatch {
  workDate?: string
  minutes?: number
  note?: string
}

export async function updateWorkHours(id: number, patch: WorkHoursPatch): Promise<WorkHoursRow> {
  const db = getDb()

  // Правка никогда не переснимает ставку — меняются только день, минуты и примечание.
  // Пустой patch — no-op: .set({}) в drizzle бросает ошибку, поэтому возвращаем текущую строку.
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
  // Сначала проверяем мастера: иначе FK отклонил бы неизвестный masterId невнятным
  // 500. master_rates намеренно НЕ читается — выплата самодостаточна, поэтому
  // её может получить и мастер без ставки.
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

  // При правке мастер никогда не меняется. Пустой patch — no-op: .set({}) в drizzle
  // бросает ошибку, поэтому возвращаем текущую строку.
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
