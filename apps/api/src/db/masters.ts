import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import { bookingMasters, bookings, masters, workHours, type Master } from './schema.js'

export type MasterMutationError =
  | 'duplicate_name'
  | 'not_found'
  | 'invalid_order'
  | 'has_work_hours'
  | 'has_bookings'

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
}

export async function listMasters(): Promise<Master[]> {
  const db = getDb()
  return db.select().from(masters).orderBy(masters.position, masters.id)
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
  const [existing] = await db
    .select({ id: masters.id })
    .from(masters)
    .where(eq(masters.name, input.name))
    .limit(1)
  if (existing) throw new MasterError('duplicate_name')

  const position = await nextPosition()
  const [row] = await db
    .insert(masters)
    .values({
      name: input.name,
      canBeResponsible: input.canBeResponsible,
      paidSalary: input.paidSalary,
      telegramId: input.telegramId,
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
}

export async function updateMaster(id: number, patch: MasterPatch): Promise<Master> {
  const db = getDb()

  if (patch.name !== undefined) {
    const [duplicate] = await db
      .select({ id: masters.id })
      .from(masters)
      .where(eq(masters.name, patch.name))
      .limit(1)
    if (duplicate && duplicate.id !== id) throw new MasterError('duplicate_name')
  }

  const [row] = await db.update(masters).set(patch).where(eq(masters.id, id)).returning()
  if (!row) throw new MasterError('not_found')
  return row
}

export async function deleteMaster(id: number): Promise<void> {
  const db = getDb()
  // Payment history in work_hours references this master with onDelete:'restrict'
  // — Postgres would reject the delete. Refuse it explicitly so the route can
  // surface a 409 instead of a generic 500 (mirrors deleteClient/has_bookings).
  const [linkedWork] = await db
    .select({ id: workHours.id })
    .from(workHours)
    .where(eq(workHours.masterId, id))
    .limit(1)
  if (linkedWork) throw new MasterError('has_work_hours')
  // Booking history references this master by id-link (junction and/or the
  // responsible_id FK). Both would `cascade`/`set null` silently, orphaning the
  // history from its master; refuse instead so a rename is the only path and the
  // live-name history stays intact.
  const [linkedJunction] = await db
    .select({ bookingId: bookingMasters.bookingId })
    .from(bookingMasters)
    .where(eq(bookingMasters.masterId, id))
    .limit(1)
  if (linkedJunction) throw new MasterError('has_bookings')
  const [linkedResponsible] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.responsibleId, id))
    .limit(1)
  if (linkedResponsible) throw new MasterError('has_bookings')
  const result = await db.delete(masters).where(eq(masters.id, id)).returning({ id: masters.id })
  if (result.length === 0) throw new MasterError('not_found')
}

// Assigns dense positions 0..n-1 in the given order. The posted id set must
// equal the full set of rows (active + inactive) — a partial or foreign set is
// rejected without touching the table, so positions can't silently desync.
export async function reorderMasters(ids: number[]): Promise<Master[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: masters.id }).from(masters)
    const existingIds = new Set(existing.map((r) => r.id))
    const postedIds = new Set(ids)
    const sameSize = postedIds.size === ids.length && existingIds.size === postedIds.size
    const sameMembers = sameSize && ids.every((id) => existingIds.has(id))
    if (!sameMembers) throw new MasterError('invalid_order')

    for (let i = 0; i < ids.length; i++) {
      await tx.update(masters).set({ position: i }).where(eq(masters.id, ids[i]))
    }
    return tx.select().from(masters).orderBy(masters.position, masters.id)
  })
}
