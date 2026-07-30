import { and, eq, ne } from 'drizzle-orm'
import { getDb } from './client.js'
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

export async function listClients(): Promise<Client[]> {
  const db = getDb()
  return db.select().from(clients)
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

export async function createClient(phone: string, name: string): Promise<Client> {
  const db = getDb()
  const [existing] = await db.select().from(clients).where(eq(clients.phone, phone)).limit(1)
  if (existing) throw new ClientError('duplicate_phone')
  const [row] = await db.insert(clients).values({ phone, name }).returning()
  return row
}

export async function updateClient(id: string, phone: string, name: string): Promise<Client> {
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
  return row
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
