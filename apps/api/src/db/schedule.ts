import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm'
import type { MasterSchedule, ScheduleDayInput } from '@detailing-admin/shared'
import type { Tx } from './audit.js'
import { getDb, type Db } from './client.js'
import { masterSchedule, masters } from './schema.js'

export class ScheduleError extends Error {
  constructor(public readonly code: 'not_found') {
    super(code)
    this.name = 'ScheduleError'
  }
}

// Архивные мастера исключены, как и в GET /api/masters: график читают все роли,
// а архивного мастера нет ни в одном пикере.
export async function listSchedule(from: string, to: string): Promise<MasterSchedule[]> {
  const db = getDb()
  const rows = await db
    .select({ masterId: masterSchedule.masterId, workDate: masterSchedule.workDate })
    .from(masterSchedule)
    .innerJoin(masters, eq(masters.id, masterSchedule.masterId))
    .where(
      and(
        eq(masters.archived, false),
        gte(masterSchedule.workDate, from),
        lte(masterSchedule.workDate, to),
      ),
    )
    .orderBy(asc(masterSchedule.masterId), asc(masterSchedule.workDate))

  const byMaster = new Map<number, string[]>()
  for (const r of rows) {
    const dates = byMaster.get(r.masterId)
    if (dates) dates.push(r.workDate)
    else byMaster.set(r.masterId, [r.workDate])
  }
  return [...byMaster].map(([masterId, dates]) => ({ masterId, dates }))
}

// Все или ничего: если хоть один мастер архивный или не найден, не пишется ни один
// день. Идемпотентно — повтор того же сохранения ничего не меняет.
export async function setScheduleDays(days: readonly ScheduleDayInput[]): Promise<void> {
  await getDb().transaction((tx) => applyScheduleDays(tx, days))
}

// Без своей транзакции: одобрение заявки применяет дни в той же транзакции, что
// и смену статуса.
export async function applyScheduleDays(
  tx: Db | Tx,
  days: readonly ScheduleDayInput[],
): Promise<void> {
  const ids = [...new Set(days.map((d) => d.masterId))]
  const found = await tx
    .select({ id: masters.id })
    .from(masters)
    .where(and(inArray(masters.id, ids), eq(masters.archived, false)))
  if (found.length !== ids.length) throw new ScheduleError('not_found')

  const working = days.filter((d) => d.working)
  const off = days.filter((d) => !d.working)
  if (working.length > 0) {
    await tx
      .insert(masterSchedule)
      .values(working.map((d) => ({ masterId: d.masterId, workDate: d.date })))
      .onConflictDoNothing()
  }
  if (off.length > 0) {
    await tx
      .delete(masterSchedule)
      .where(
        or(
          ...off.map((d) =>
            and(eq(masterSchedule.masterId, d.masterId), eq(masterSchedule.workDate, d.date)),
          ),
        ),
      )
  }
}
