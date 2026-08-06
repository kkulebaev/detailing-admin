import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { normalizePhone } from '@detailing-admin/shared/phone'
import type { Car, CarInput, ClientStats } from '@detailing-admin/shared/client'
import { getDb } from './client.js'
import { listCarsByClient, syncClientCars } from './client-cars.js'
import { REVENUE_READINESS } from './analytics.js'
import { bookings, clients, type Client } from './schema.js'

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged' | 'skipped'

export interface UpsertResult {
  outcome: UpsertOutcome
  client: Client | null
}

export type ClientMutationError = 'duplicate_phone' | 'not_found' | 'has_bookings'

export class ClientError extends Error {
  constructor(public readonly code: ClientMutationError) {
    super(code)
    this.name = 'ClientError'
  }
}

export interface ListClientsParams {
  limit: number
  offset: number
  /** Free-text search across name/phone. A phone-looking term is normalized to
   * E.164 before matching the stored (E.164) phone. */
  q?: string
  /** Sort column. Defaults to name. */
  sort?: 'name' | 'phone' | 'createdAt'
  dir?: 'asc' | 'desc'
}

export async function listClients(
  p: ListClientsParams,
): Promise<{ items: Client[]; total: number }> {
  const db = getDb()

  const q = p.q?.trim()
  let where
  if (q) {
    const textLike = `%${q}%`
    // The stored phone is E.164, but staff type `8XXX`; normalize so a phone
    // search still matches. normalizePhone throws on non-phone input — fall back
    // to raw text matching in that case.
    let phoneLike = textLike
    try {
      const normalized = normalizePhone(q)
      if (normalized) phoneLike = `%${normalized}%`
    } catch {
      // Not a phone — keep the text pattern.
    }
    where = or(ilike(clients.name, textLike), ilike(clients.phone, phoneLike))
  }

  const direction = p.dir === 'desc' ? desc : asc
  let orderBy
  if (p.sort === 'phone') {
    orderBy = [direction(clients.phone)]
  } else if (p.sort === 'createdAt') {
    orderBy = [direction(clients.createdAt)]
  } else {
    // Empty names always sort last (regardless of direction), matching the
    // UI's collator ordering; then by name in the requested direction.
    orderBy = [asc(sql`${clients.name} = ''`), direction(sql`lower(${clients.name})`)]
  }

  const items = await db
    .select()
    .from(clients)
    .where(where)
    .orderBy(...orderBy)
    .limit(p.limit)
    .offset(p.offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clients)
    .where(where)

  return { items, total: countRow?.count ?? 0 }
}

/**
 * Upsert a client by phone. Caller must pass an already-normalized E.164 phone
 * (or empty string — empty phones are skipped, since phone is the natural key).
 * Empty incoming `name` never overwrites an existing non-empty name.
 */
export async function upsertClient(phone: string, name: string): Promise<UpsertResult> {
  if (phone.length === 0) {
    return { outcome: 'skipped', client: null }
  }

  const db = getDb()

  if (name.length === 0) {
    const inserted = await db
      .insert(clients)
      .values({ phone, name: '' })
      .onConflictDoNothing({ target: clients.phone })
      .returning()

    if (inserted.length > 0) {
      return { outcome: 'inserted', client: inserted[0] ?? null }
    }
    const [existing] = await db.select().from(clients).where(eq(clients.phone, phone)).limit(1)
    return { outcome: 'unchanged', client: existing ?? null }
  }

  const [before] = await db.select().from(clients).where(eq(clients.phone, phone)).limit(1)

  const [after] = await db
    .insert(clients)
    .values({ phone, name })
    .onConflictDoUpdate({
      target: clients.phone,
      set: { name },
    })
    .returning()

  if (!before) return { outcome: 'inserted', client: after ?? null }
  if (before.name !== name) return { outcome: 'updated', client: after ?? null }
  return { outcome: 'unchanged', client: after ?? null }
}

// Returns the persisted client together with its actual cars (post-sync), so
// the route can echo the reconciled set back to the dialog.
export async function createClient(
  phone: string,
  name: string,
  cars: CarInput[] = [],
): Promise<{ client: Client; cars: Car[] }> {
  const db = getDb()
  const [existing] = await db.select().from(clients).where(eq(clients.phone, phone)).limit(1)
  if (existing) throw new ClientError('duplicate_phone')
  const [row] = await db.insert(clients).values({ phone, name }).returning()
  await syncClientCars(row.id, cars)
  return { client: row, cars: await listCarsByClient(row.id) }
}

export async function updateClient(
  id: string,
  phone: string,
  name: string,
  cars: CarInput[] = [],
): Promise<{ client: Client; cars: Car[] }> {
  const db = getDb()
  const [duplicate] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.phone, phone), ne(clients.id, id)))
    .limit(1)
  if (duplicate) throw new ClientError('duplicate_phone')
  const [row] = await db
    .update(clients)
    .set({ phone, name })
    .where(eq(clients.id, id))
    .returning()
  if (!row) throw new ClientError('not_found')
  await syncClientCars(row.id, cars)
  return { client: row, cars: await listCarsByClient(row.id) }
}

export async function getClientById(id: string): Promise<Client | null> {
  const db = getDb()
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
  return row ?? null
}

// Lifetime «Выдана»-only aggregates for the client card. Same REVENUE_READINESS
// predicate as analytics (not the literal hardcoded twice), but no period window.
// postgres-js returns SUM/COUNT as strings → Number(); MAX/MIN(date_from) come
// back as 'YYYY-MM-DD' (or null). Caveat: date_from is the planned service date,
// not the delivery fact, so MAX among «Выдана» can land on a future/multi-day
// start date — the same approximation analytics accepts when bucketing by date_from.
export async function getClientStats(clientId: string): Promise<ClientStats> {
  const db = getDb()
  const [row] = await db
    .select({
      totalSpent: sql<string>`coalesce(sum(${bookings.amount}), 0)`,
      visitCount: sql<string>`count(*)`,
      lastVisit: sql<string | null>`max(${bookings.dateFrom})`,
      firstVisit: sql<string | null>`min(${bookings.dateFrom})`,
    })
    .from(bookings)
    .where(
      and(eq(bookings.clientId, clientId), inArray(bookings.readiness, [...REVENUE_READINESS])),
    )
  return {
    totalSpent: Number(row?.totalSpent ?? 0),
    visitCount: Number(row?.visitCount ?? 0),
    lastVisit: row?.lastVisit ?? null,
    firstVisit: row?.firstVisit ?? null,
  }
}

export async function deleteClient(id: string): Promise<void> {
  const db = getDb()
  // A booking FK (bookings.client_id) still references this client — Postgres
  // would reject the delete. Refuse it explicitly so the route can surface a
  // 409 instead of a generic 500; the bookings mirror is retained deliberately.
  const [linked] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.clientId, id))
    .limit(1)
  if (linked) throw new ClientError('has_bookings')
  const result = await db.delete(clients).where(eq(clients.id, id)).returning({ id: clients.id })
  if (result.length === 0) throw new ClientError('not_found')
}
