import { and, asc, desc, eq } from 'drizzle-orm'
import type { ScheduleRequest, ScheduleRequestDay } from '@detailing-admin/shared'
import { MY_SCHEDULE_REQUESTS_LIMIT } from '@detailing-admin/shared'
import type { AuditActor } from './audit.js'
import { getDb } from './client.js'
import { applyScheduleDays, ScheduleError } from './schedule.js'
import { masters, scheduleRequests, type ScheduleRequestRow } from './schema.js'

export type ScheduleRequestErrorCode = 'not_found' | 'pending_exists' | 'already_decided'

export class ScheduleRequestError extends Error {
  constructor(public readonly code: ScheduleRequestErrorCode) {
    super(code)
    this.name = 'ScheduleRequestError'
  }
}

function toWire(row: ScheduleRequestRow, masterName: string): ScheduleRequest {
  return {
    id: row.id,
    masterId: row.masterId,
    masterName,
    status: row.status,
    days: row.days,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedByName,
  }
}

const withMaster = { request: scheduleRequests, masterName: masters.name }

export async function listMyScheduleRequests(masterId: number): Promise<ScheduleRequest[]> {
  const rows = await getDb()
    .select(withMaster)
    .from(scheduleRequests)
    .innerJoin(masters, eq(masters.id, scheduleRequests.masterId))
    .where(eq(scheduleRequests.masterId, masterId))
    .orderBy(desc(scheduleRequests.createdAt), desc(scheduleRequests.id))
    .limit(MY_SCHEDULE_REQUESTS_LIMIT)
  return rows.map((r) => toWire(r.request, r.masterName))
}

// Заявки архивных мастеров не показываем: одобрить их все равно нельзя.
export async function listPendingScheduleRequests(): Promise<ScheduleRequest[]> {
  const rows = await getDb()
    .select(withMaster)
    .from(scheduleRequests)
    .innerJoin(masters, eq(masters.id, scheduleRequests.masterId))
    .where(and(eq(scheduleRequests.status, 'pending'), eq(masters.archived, false)))
    .orderBy(asc(scheduleRequests.createdAt), asc(scheduleRequests.id))
  return rows.map((r) => toWire(r.request, r.masterName))
}

// Строка мастера блокируется, чтобы две одновременные отправки не прошли обе проверку
// «нет заявки на согласовании»; частичный UNIQUE в схеме — страховка на тот же случай.
export async function createScheduleRequest(
  masterId: number,
  days: readonly ScheduleRequestDay[],
): Promise<ScheduleRequest> {
  return getDb().transaction(async (tx) => {
    const [master] = await tx
      .select({ name: masters.name })
      .from(masters)
      .where(and(eq(masters.id, masterId), eq(masters.archived, false)))
      .for('update')
    if (!master) throw new ScheduleRequestError('not_found')

    const [pending] = await tx
      .select({ id: scheduleRequests.id })
      .from(scheduleRequests)
      .where(and(eq(scheduleRequests.masterId, masterId), eq(scheduleRequests.status, 'pending')))
      .limit(1)
    if (pending) throw new ScheduleRequestError('pending_exists')

    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const [row] = await tx.insert(scheduleRequests).values({ masterId, days: sorted }).returning()
    return toWire(row!, master.name)
  })
}

// Отозванная заявка удаляется: в истории ей делать нечего, решения по ней не было.
export async function withdrawScheduleRequest(masterId: number, id: number): Promise<void> {
  const db = getDb()
  const [row] = await db
    .select({ status: scheduleRequests.status })
    .from(scheduleRequests)
    .where(and(eq(scheduleRequests.id, id), eq(scheduleRequests.masterId, masterId)))
    .limit(1)
  if (!row) throw new ScheduleRequestError('not_found')
  const deleted = await db
    .delete(scheduleRequests)
    .where(and(eq(scheduleRequests.id, id), eq(scheduleRequests.status, 'pending')))
    .returning({ id: scheduleRequests.id })
  if (deleted.length === 0) throw new ScheduleRequestError('already_decided')
}

type Decision = { approve: true } | { approve: false; comment: string | null }

// Заявка блокируется до проверки статуса: второй админ, нажавший одновременно,
// получит already_decided, а не применит дни повторно.
export async function decideScheduleRequest(
  id: number,
  actor: AuditActor,
  decision: Decision,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scheduleRequests)
      .where(eq(scheduleRequests.id, id))
      .for('update')
    if (!row) throw new ScheduleRequestError('not_found')
    if (row.status !== 'pending') throw new ScheduleRequestError('already_decided')

    if (decision.approve) {
      try {
        await applyScheduleDays(
          tx,
          row.days.map((d) => ({ masterId: row.masterId, date: d.date, working: d.working })),
        )
      } catch (err) {
        // Мастера заархивировали, пока заявка ждала решения.
        if (err instanceof ScheduleError) throw new ScheduleRequestError('not_found')
        throw err
      }
    }

    await tx
      .update(scheduleRequests)
      .set({
        status: decision.approve ? 'approved' : 'rejected',
        comment: decision.approve ? null : decision.comment,
        decidedAt: new Date(),
        decidedById: actor.id,
        decidedByName: actor.name || actor.login,
      })
      .where(eq(scheduleRequests.id, id))
  })
}
