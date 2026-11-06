import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import { masters, users, type Master } from './schema.js'

export type MasterMutationError =
  | 'duplicate_name'
  | 'archived_name'
  | 'duplicate_user'
  | 'unknown_user'
  | 'not_found'
  | 'invalid_order'

export class MasterError extends Error {
  constructor(public readonly code: MasterMutationError) {
    super(code)
    this.name = 'MasterError'
  }
}

export interface MasterInput {
  name: string
  canBeResponsible: boolean
  paidSalary: boolean
  telegramId: string | null
  userId: string | null
}

export async function listMasters(): Promise<Master[]> {
  const db = getDb()
  return db
    .select()
    .from(masters)
    .where(eq(masters.archived, false))
    .orderBy(masters.position, masters.id)
}

// An archived master keeps the UNIQUE name but is invisible in the app, so the
// clash gets its own code: «already exists» would point at a row nobody can see.
async function assertNameFree(name: string, masterId?: number) {
  const db = getDb()
  const [duplicate] = await db
    .select({ id: masters.id, archived: masters.archived })
    .from(masters)
    .where(eq(masters.name, name))
    .limit(1)
  if (!duplicate || duplicate.id === masterId) return
  throw new MasterError(duplicate.archived ? 'archived_name' : 'duplicate_name')
}

// Names are unique (see the `name` unique constraint), so this resolves at most
// one row. Used to look up a master's Telegram chat id from the free-form name
// stored on a booking.
export async function findMasterByName(name: string): Promise<Master | undefined> {
  const db = getDb()
  const [row] = await db.select().from(masters).where(eq(masters.name, name)).limit(1)
  return row
}

// Batch, best-effort name→id resolver for the booking↔master id-link. Trims and
// dedups the requested names, then matches them against the UNIQUE `masters.name`
// (same exact-match semantics as findMasterByName). An unmatched name is simply
// absent from the map — by design, not an error. Empty input short-circuits.
export async function resolveMasterIds(names: string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (wanted.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ id: masters.id, name: masters.name })
    .from(masters)
    .where(inArray(masters.name, wanted))
  return new Map(rows.map((r) => [r.name, r.id]))
}

export async function findMasterByUserId(userId: string): Promise<Master | undefined> {
  const db = getDb()
  const [row] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1)
  return row
}

// Probed up front so the route can answer with a field error / 409 instead of the
// opaque 500 the FK or the UNIQUE constraint would otherwise raise.
async function assertUserLinkable(userId: string | null | undefined, masterId?: number) {
  if (userId == null) return
  const db = getDb()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new MasterError('unknown_user')
  const linked = await findMasterByUserId(userId)
  if (linked && linked.id !== masterId) throw new MasterError('duplicate_user')
}

// Next slot at the end of the ordered list. -1 + 1 = 0 when the table is empty.
async function nextPosition(): Promise<number> {
  const db = getDb()
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${masters.position}), -1)` })
    .from(masters)
  return max + 1
}

export async function createMaster(input: MasterInput): Promise<Master> {
  const db = getDb()
  await assertNameFree(input.name)
  await assertUserLinkable(input.userId)

  const position = await nextPosition()
  const [row] = await db
    .insert(masters)
    .values({
      name: input.name,
      canBeResponsible: input.canBeResponsible,
      paidSalary: input.paidSalary,
      telegramId: input.telegramId,
      userId: input.userId,
      position,
    })
    .returning()
  return row
}

export interface MasterPatch {
  name?: string
  canBeResponsible?: boolean
  paidSalary?: boolean
  telegramId?: string | null
  userId?: string | null
}

export async function updateMaster(id: number, patch: MasterPatch): Promise<Master> {
  const db = getDb()

  if (patch.name !== undefined) await assertNameFree(patch.name, id)
  await assertUserLinkable(patch.userId, id)

  const [row] = await db
    .update(masters)
    .set(patch)
    .where(and(eq(masters.id, id), eq(masters.archived, false)))
    .returning()
  if (!row) throw new MasterError('not_found')
  return row
}

// Soft delete: bookings, hours and payouts must keep pointing at this row. The
// account is released because the UNIQUE link would otherwise block attaching it
// to another master through a row the admin can no longer see, and because a
// removed master shouldn't keep logging hours on «Мои часы».
export async function deleteMaster(id: number): Promise<void> {
  const db = getDb()
  const result = await db
    .update(masters)
    .set({ archived: true, userId: null })
    .where(and(eq(masters.id, id), eq(masters.archived, false)))
    .returning({ id: masters.id })
  if (result.length === 0) throw new MasterError('not_found')
}

// Assigns dense positions 0..n-1 in the given order. The posted id set must
// equal the full set of non-archived rows — a partial or foreign set is
// rejected without touching the table, so positions can't silently desync.
export async function reorderMasters(ids: number[]): Promise<Master[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: masters.id })
      .from(masters)
      .where(eq(masters.archived, false))
    const existingIds = new Set(existing.map((r) => r.id))
    const postedIds = new Set(ids)
    const sameSize = postedIds.size === ids.length && existingIds.size === postedIds.size
    const sameMembers = sameSize && ids.every((id) => existingIds.has(id))
    if (!sameMembers) throw new MasterError('invalid_order')

    for (let i = 0; i < ids.length; i++) {
      await tx.update(masters).set({ position: i }).where(eq(masters.id, ids[i]))
    }
    return tx
      .select()
      .from(masters)
      .where(eq(masters.archived, false))
      .orderBy(masters.position, masters.id)
  })
}
