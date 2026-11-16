import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { MasterSchedule } from '@detailing-admin/shared'
import { getDb } from './client.js'
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

// Идемпотентно: повторное «рабочий» или «выходной» для того же дня ничего не меняет,
// так что двойной тап или повтор запроса безопасны.
export async function setScheduleDay(
  masterId: number,
  date: string,
  working: boolean,
): Promise<void> {
  const db = getDb()
  const [master] = await db
    .select({ id: masters.id })
    .from(masters)
    .where(and(eq(masters.id, masterId), eq(masters.archived, false)))
    .limit(1)
  if (!master) throw new ScheduleError('not_found')

  if (working) {
    await db.insert(masterSchedule).values({ masterId, workDate: date }).onConflictDoNothing()
  } else {
    await db
      .delete(masterSchedule)
      .where(and(eq(masterSchedule.masterId, masterId), eq(masterSchedule.workDate, date)))
  }
}
