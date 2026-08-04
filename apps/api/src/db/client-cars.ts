import { inArray } from 'drizzle-orm'
import { normalizeCarKey } from '@detailing-admin/shared/car'
import type { Car } from '@detailing-admin/shared/client'
import { getDb } from './client.js'
import { clientCars } from './schema.js'

/**
 * Best-effort ingest of a client's car from a booking. Normalizes make/model and
 * plate before insert: the UNIQUE index sits on the raw columns, so
 * `onConflictDoNothing` only dedupes when we write the already-normalized values.
 * No-op on an empty make/model (a car with no model is meaningless as a key).
 */
export async function upsertClientCar(
  clientId: string,
  makeModel: string,
  plate: string,
): Promise<void> {
  const normMakeModel = normalizeCarKey(makeModel)
  if (normMakeModel.length === 0) return

  const normPlate = normalizeCarKey(plate, true)
  const db = getDb()
  await db
    .insert(clientCars)
    .values({ clientId, makeModel: normMakeModel, plate: normPlate })
    .onConflictDoNothing({
      target: [clientCars.clientId, clientCars.makeModel, clientCars.plate],
    })
}

/**
 * Fetch cars for a page of clients in one grouped query (avoids N+1 on the list
 * route). Returns a map keyed by clientId; a client with no cars is simply
 * absent. An empty `ids` short-circuits without hitting the DB.
 */
export async function listCarsByClientIds(ids: string[]): Promise<Map<string, Car[]>> {
  const byClient = new Map<string, Car[]>()
  if (ids.length === 0) return byClient

  const db = getDb()
  const rows = await db
    .select({
      id: clientCars.id,
      clientId: clientCars.clientId,
      makeModel: clientCars.makeModel,
      plate: clientCars.plate,
    })
    .from(clientCars)
    .where(inArray(clientCars.clientId, ids))

  for (const row of rows) {
    const car: Car = { id: row.id, makeModel: row.makeModel, plate: row.plate }
    const list = byClient.get(row.clientId)
    if (list) list.push(car)
    else byClient.set(row.clientId, [car])
  }
  return byClient
}
