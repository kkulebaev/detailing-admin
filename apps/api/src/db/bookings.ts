import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import type { Booking as WireBooking } from '@detailing-admin/shared/booking'
import { joinCar } from '@detailing-admin/shared/car'
import { ddmmyyyyToIso } from '@detailing-admin/shared/date'
import { normalizePhone } from '@detailing-admin/shared/phone'
import { getDb } from './client.js'
import { bookings, type Booking, type NewBooking } from './schema.js'

/** Per-write context the wire booking doesn't carry: the idempotency key, the
 * linked client (null for an empty phone), and the Sheets coordinates returned
 * by the append that just landed. */
export interface BookingWriteMeta {
  idempotencyKey: string
  clientId: string | null
  sheetRow: number | null
  sheetRange: string | null
}

/** The booking's user-editable columns (everything except the internal
 * idempotency/client/sheet linkage). Shared by insert and update so both map the
 * wire booking the same way. */
function mapEditableFields(b: WireBooking) {
  return {
    name: b.name,
    phone: b.phone,
    // Зеркало bookings.car хранит склеенную строку (марка/модель + номер),
    // как раньше писала форма — единый формат через joinCar (см. shared/car.ts).
    car: joinCar(b.car, b.plate),
    service: b.service,
    note: b.note,
    // `amount` is `'' | number` on the wire type — the schema's refine guarantees
    // a number at runtime but doesn't narrow the static type. The '' branch is
    // unreachable here (validation rejects it before the handler runs).
    amount: typeof b.amount === 'number' ? b.amount : 0,
    amountFormula: b.amountFormula ?? null,
    dateFrom: ddmmyyyyToIso(b.dateFrom),
    dateTo: b.dateTo ? ddmmyyyyToIso(b.dateTo) : null,
    timeFrom: b.time,
    timeTo: b.timeTo ?? null,
    readiness: b.readiness,
    master: b.master,
    responsible: b.responsible,
    carClass: b.carClass,
  }
}

export function bookingToDbRow(b: WireBooking, meta: BookingWriteMeta): NewBooking {
  return {
    idempotencyKey: meta.idempotencyKey,
    clientId: meta.clientId,
    sheetRow: meta.sheetRow,
    sheetRange: meta.sheetRange,
    ...mapEditableFields(b),
  }
}

/** Best-effort mirror insert. Idempotent on `idempotencyKey`: a duplicate key is
 * a no-op (returns false), never an error — a post-TTL client retry must not
 * create a second row. */
export async function insertBooking(b: WireBooking, meta: BookingWriteMeta): Promise<boolean> {
  const db = getDb()
  const inserted = await db
    .insert(bookings)
    .values(bookingToDbRow(b, meta))
    .onConflictDoNothing({ target: bookings.idempotencyKey })
    .returning({ id: bookings.id })
  return inserted.length > 0
}

/** Update a booking's editable fields (and re-linked client). Leaves the
 * idempotency key and Sheets linkage untouched. Returns the updated row, or null
 * if no booking has that id. */
export async function updateBooking(
  id: string,
  b: WireBooking,
  clientId: string | null,
): Promise<Booking | null> {
  const db = getDb()
  const [row] = await db
    .update(bookings)
    .set({ ...mapEditableFields(b), clientId })
    .where(eq(bookings.id, id))
    .returning()
  return row ?? null
}

/** Update only a booking's readiness (the quick inline status change). Returns
 * the updated row, or null if no booking has that id. */
export async function updateBookingReadiness(
  id: string,
  readiness: string,
): Promise<Booking | null> {
  const db = getDb()
  const [row] = await db
    .update(bookings)
    .set({ readiness })
    .where(eq(bookings.id, id))
    .returning()
  return row ?? null
}

/** Delete a booking by id. Returns false if no row matched. */
export async function deleteBooking(id: string): Promise<boolean> {
  const db = getDb()
  const res = await db.delete(bookings).where(eq(bookings.id, id)).returning({ id: bookings.id })
  return res.length > 0
}

export interface ListBookingsParams {
  limit: number
  offset: number
  /** ISO `YYYY-MM-DD`; filters rows whose `dateFrom` is >= this. */
  dateFrom?: string
  /** ISO `YYYY-MM-DD`; filters rows whose `dateFrom` is <= this. */
  dateTo?: string
  master?: string
  readiness?: string
  /** Free-text search across name/car/phone. A phone-looking term is normalized
   * to E.164 before matching the stored (E.164) phone. */
  q?: string
}

export async function listBookings(
  p: ListBookingsParams,
): Promise<{ items: Booking[]; total: number }> {
  const db = getDb()

  const conds = []
  if (p.dateFrom) conds.push(gte(bookings.dateFrom, p.dateFrom))
  if (p.dateTo) conds.push(lte(bookings.dateFrom, p.dateTo))
  if (p.master) conds.push(eq(bookings.master, p.master))
  if (p.readiness) conds.push(eq(bookings.readiness, p.readiness))

  const q = p.q?.trim()
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
    conds.push(
      or(ilike(bookings.name, textLike), ilike(bookings.car, textLike), ilike(bookings.phone, phoneLike)),
    )
  }

  const where = conds.length ? and(...conds) : undefined

  const items = await db
    .select()
    .from(bookings)
    .where(where)
    .orderBy(desc(bookings.dateFrom), desc(bookings.createdAt))
    .limit(p.limit)
    .offset(p.offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(where)

  return { items, total: countRow?.count ?? 0 }
}
