import { asc } from 'drizzle-orm'
import { minutesToTime, timeToMinutes, type StudioDay } from '@detailing-admin/shared'
import { getDb } from './client.js'
import { studioHours } from './schema.js'

export async function getStudioHours(): Promise<StudioDay[]> {
  const rows = await getDb().select().from(studioHours).orderBy(asc(studioHours.weekday))
  return rows.map((r) => ({
    weekday: r.weekday,
    opensAt: minutesToTime(r.opensAt),
    closesAt: minutesToTime(r.closesAt),
  }))
}

// Режим заменяется целиком: день, которого нет в списке, становится выходным.
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
