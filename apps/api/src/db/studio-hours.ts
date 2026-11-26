import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { minutesToTime, timeToMinutes, type StudioDay } from '@detailing-admin/shared'
import type { Tx } from './audit.js'
import { getDb, type Db } from './client.js'
import { studioClosedDays, studioHours } from './schema.js'

export async function getStudioHours(db: Db | Tx = getDb()): Promise<StudioDay[]> {
  const rows = await db.select().from(studioHours).orderBy(asc(studioHours.weekday))
  return rows.map((r) => ({
    weekday: r.weekday,
    opensAt: minutesToTime(r.opensAt),
    closesAt: minutesToTime(r.closesAt),
  }))
}

// Режим заменяется целиком: день, которого нет в списке, становится выходным.
// Уже отмеченные в такие дни мастера остаются: снять их — решение админа.
export async function setStudioHours(days: readonly StudioDay[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(studioHours)
    await tx.insert(studioHours).values(
      days.map((d) => ({
        weekday: d.weekday,
        opensAt: timeToMinutes(d.opensAt),
        closesAt: timeToMinutes(d.closesAt),
      })),
    )
  })
}

export async function listClosedDays(from: string, to: string): Promise<string[]> {
  const rows = await getDb()
    .select({ date: studioClosedDays.date })
    .from(studioClosedDays)
    .where(and(gte(studioClosedDays.date, from), lte(studioClosedDays.date, to)))
    .orderBy(asc(studioClosedDays.date))
  return rows.map((r) => r.date)
}

// Какие из `dates` — разовые выходные; для проверки рабочих дней внутри транзакции.
export async function closedDatesAmong(db: Db | Tx, dates: readonly string[]): Promise<string[]> {
  if (dates.length === 0) return []
  const rows = await db
    .select({ date: studioClosedDays.date })
    .from(studioClosedDays)
    .where(inArray(studioClosedDays.date, [...new Set(dates)]))
  return rows.map((r) => r.date)
}

// Идемпотентно: уже добавленные дни диапазона пропускаются. Отмеченные в эти дни
// мастера остаются, как и при смене режима: снять их — решение админа.
export async function addClosedDays(dates: readonly string[]): Promise<void> {
  await getDb()
    .insert(studioClosedDays)
    .values(dates.map((date) => ({ date })))
    .onConflictDoNothing()
}

export async function deleteClosedDay(date: string): Promise<boolean> {
  const rows = await getDb()
    .delete(studioClosedDays)
    .where(eq(studioClosedDays.date, date))
    .returning({ date: studioClosedDays.date })
  return rows.length > 0
}
