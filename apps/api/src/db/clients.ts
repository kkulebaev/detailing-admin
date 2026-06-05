import { eq } from 'drizzle-orm'
import { getDb } from './client.js'
import { clients, type Client } from './schema.js'

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged' | 'skipped'

export interface UpsertResult {
  outcome: UpsertOutcome
  client: Client | null
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
