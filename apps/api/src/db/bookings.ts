import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import type { Booking as WireBooking } from '@detailing-admin/shared/booking'
import type { BookingRow } from '@detailing-admin/shared/booking-row'
import { joinCar } from '@detailing-admin/shared/car'
import { ddmmyyyyToIso } from '@detailing-admin/shared/date'
import { normalizePhone } from '@detailing-admin/shared/phone'
import type { Readiness } from '@detailing-admin/shared/enums'
import { getDb } from './client.js'
import { resolveMasterIds } from './masters.js'
import { bookingMasters, bookings, masters, type Booking, type NewBooking } from './schema.js'
import { baseLogger } from '../log.js'

/** Per-write context the wire booking doesn't carry: the idempotency key, the
 * linked client (null for an empty phone), and the Sheets coordinates returned
 * by the append that just landed. */
export interface BookingWriteMeta {
  idempotencyKey: string
  clientId: string | null
  // Derived id-link to the client's normalized car row, resolved in the route
  // (where the car ingest already runs) so the insert doesn't re-upsert. Null
  // when unresolved — the snapshot `car` string stays authoritative.
  carId: string | null
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

export function bookingToDbRow(
  b: WireBooking,
  meta: BookingWriteMeta,
  responsibleId: number | null = null,
): NewBooking {
  return {
    idempotencyKey: meta.idempotencyKey,
    clientId: meta.clientId,
    carId: meta.carId,
    sheetRow: meta.sheetRow,
    sheetRange: meta.sheetRange,
    responsibleId,
    ...mapEditableFields(b),
  }
}

/** Junction rows for the masters that resolved to an id, deduped by id (two
 * distinct names can't share an id, but the snapshot may list a name twice —
 * the first occurrence wins the position). `position` is the name's index in the
 * snapshot array, so the read side can overlay a live name onto `master[i]`. An
 * unmatched name is skipped — the id-link is intentionally partial. */
function matchedMasterRows(
  bookingId: string,
  masterNames: string[],
  ids: Map<string, number>,
): { bookingId: string; masterId: number; position: number }[] {
  const seen = new Set<number>()
  const rows: { bookingId: string; masterId: number; position: number }[] = []
  for (let i = 0; i < masterNames.length; i++) {
    const masterId = ids.get(masterNames[i].trim())
    if (masterId !== undefined && !seen.has(masterId)) {
      seen.add(masterId)
      rows.push({ bookingId, masterId, position: i })
    }
  }
  return rows
}

/** Overlays live master names onto a page of mirror rows. The snapshot columns
 * (`master text[]`, `responsible`) stay the authoritative "as-written" record and
 * serve as the fallback; wherever an id-link exists, the master's *current* name
 * from `masters` wins — so renaming a master reflects across the whole history.
 *
 * Per row: `master[i]` becomes the live name if a junction row anchors `position
 * === i`, else the snapshot name (unmatched / deleted / legacy slot); the same
 * for `responsible` via `responsibleId`. Two batched queries for the whole page,
 * not per-row. */
async function withLiveMasterNames(rows: Booking[]): Promise<Booking[]> {
  if (rows.length === 0) return rows
  const db = getDb()

  const bookingIds = rows.map((r) => r.id)
  const links = await db
    .select({
      bookingId: bookingMasters.bookingId,
      position: bookingMasters.position,
      name: masters.name,
    })
    .from(bookingMasters)
    .innerJoin(masters, eq(bookingMasters.masterId, masters.id))
    .where(inArray(bookingMasters.bookingId, bookingIds))

  const liveByBooking = new Map<string, Map<number, string>>()
  for (const l of links) {
    const byPos = liveByBooking.get(l.bookingId) ?? new Map<number, string>()
    byPos.set(l.position, l.name)
    liveByBooking.set(l.bookingId, byPos)
  }

  const respIds = [
    ...new Set(rows.map((r) => r.responsibleId).filter((v): v is number => v != null)),
  ]
  const respNames = new Map<number, string>()
  if (respIds.length > 0) {
    const mrows = await db
      .select({ id: masters.id, name: masters.name })
      .from(masters)
      .where(inArray(masters.id, respIds))
    for (const m of mrows) respNames.set(m.id, m.name)
  }

  return rows.map((r) => {
    const byPos = liveByBooking.get(r.id)
    const master = byPos ? r.master.map((snapshot, i) => byPos.get(i) ?? snapshot) : r.master
    const responsible =
      (r.responsibleId != null ? respNames.get(r.responsibleId) : undefined) ?? r.responsible
    return { ...r, master, responsible }
  })
}

/** Maps a stored `bookings` row to its wire shape. Drops all three internal
 * id-links (`idempotencyKey`, `responsibleId`, `carId` — never part of the wire
 * response) and serializes `createdAt`. `amount`/`amountFormula` are admin-only:
 * included only when `includeAmount` — a non-admin caller must pass `false` so the
 * money fields stay omitted (undefined) in the response. */
export function toBookingRow(row: Booking, opts: { includeAmount: boolean }): BookingRow {
  const {
    idempotencyKey: _idempotencyKey,
    responsibleId: _responsibleId,
    carId: _carId,
    createdAt,
    amount,
    amountFormula,
    ...rest
  } = row
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    ...(opts.includeAmount ? { amount, amountFormula } : {}),
  }
}

/** Full booking history for one client, newest first. Fetches `limit + 1` rows so
 * the caller can flag truncation without a second COUNT; `bookings_client_id_idx`
 * keeps it cheap. Live master names are overlaid as on every read path. */
export async function listBookingsByClientId(
  clientId: string,
  limit: number,
): Promise<Booking[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.clientId, clientId))
    .orderBy(desc(bookings.dateFrom), desc(bookings.createdAt))
    .limit(limit + 1)
  return withLiveMasterNames(rows)
}

/** Best-effort mirror insert. Idempotent on `idempotencyKey`: a duplicate key is
 * a no-op (returns false), never an error — a post-TTL client retry must not
 * create a second row. Resolves master/responsible names to ids: `responsible_id`
 * is written atomically with the row; the junction is a separate step that only
 * runs on a real insert (never on a conflict no-op), so a retry adds no links. A
 * junction failure propagates to the route's best-effort catch (the booking still
 * lands in Sheets and returns 201; the link is healed by the backfill). */
export async function insertBooking(b: WireBooking, meta: BookingWriteMeta): Promise<boolean> {
  const db = getDb()
  const ids = await resolveMasterIds([...b.master, b.responsible])
  const responsibleId = ids.get(b.responsible.trim()) ?? null
  const inserted = await db
    .insert(bookings)
    .values(bookingToDbRow(b, meta, responsibleId))
    .onConflictDoNothing({ target: bookings.idempotencyKey })
    .returning({ id: bookings.id })
  if (inserted.length === 0) return false

  const masterRows = matchedMasterRows(inserted[0].id, b.master, ids)
  if (masterRows.length > 0) {
    await db.insert(bookingMasters).values(masterRows).onConflictDoNothing()
  }
  return true
}

/** Update a booking's editable fields (and re-linked client + car). Leaves the
 * idempotency key and Sheets linkage untouched. Returns the updated row, or null
 * if no booking has that id. `car_id` (resolved read-only in the route) and
 * `responsible_id` are refreshed atomically with the
 * fields; the junction is rewritten (delete + re-insert) as a separate best-effort
 * step whose failure is swallowed — the PATCH still returns 200 (Sheets is the
 * source of truth; the id-link is derived and healed by the backfill). */
export async function updateBooking(
  id: string,
  b: WireBooking,
  clientId: string | null,
  carId: string | null,
): Promise<Booking | null> {
  const db = getDb()
  const ids = await resolveMasterIds([...b.master, b.responsible])
  const responsibleId = ids.get(b.responsible.trim()) ?? null
  const [row] = await db
    .update(bookings)
    .set({ ...mapEditableFields(b), clientId, carId, responsibleId })
    .where(eq(bookings.id, id))
    .returning()
  if (!row) return null

  try {
    await db.delete(bookingMasters).where(eq(bookingMasters.bookingId, id))
    const masterRows = matchedMasterRows(id, b.master, ids)
    if (masterRows.length > 0) {
      await db.insert(bookingMasters).values(masterRows).onConflictDoNothing()
    }
  } catch (err) {
    baseLogger.warn(
      {
        event: 'booking.junction_update_failed',
        booking_id: id,
        message: err instanceof Error ? err.message : String(err),
      },
      'Booking master id-link update failed — fields saved, links stale',
    )
  }
  const [enriched] = await withLiveMasterNames([row])
  return enriched
}

/** Update only a booking's readiness (the quick inline status change). Returns
 * the updated row, or null if no booking has that id. */
export async function updateBookingReadiness(
  id: string,
  readiness: Readiness | '',
): Promise<Booking | null> {
  const db = getDb()
  const [row] = await db
    .update(bookings)
    .set({ readiness })
    .where(eq(bookings.id, id))
    .returning()
  if (!row) return null
  const [enriched] = await withLiveMasterNames([row])
  return enriched
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
  readiness?: Readiness
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
  // Filter by the master's *current* name: resolve it to an id and match the
  // junction, so records still surface after the master was renamed. Fall back
  // to snapshot membership (`= ANY(master)`) for legacy rows that never got an
  // id-link (and as the sole branch when the name resolves to no id).
  // TODO: validate master/responsible against the live roster at write time
  // (reject unknown names) so every booking always resolves to an id — then this
  // `= ANY(master)` fallback and the per-slot snapshot fallback in
  // withLiveMasterNames become dead and can be dropped for a pure id filter.
  // Prereq: give the cancellation marker (currently "Отмена" stuffed into
  // `responsible`) its own field/status first, or masters-only validation rejects it.
  if (p.master) {
    const masterId = (await resolveMasterIds([p.master])).get(p.master.trim())
    const snapshotMatch = sql`${p.master} = ANY(${bookings.master})`
    conds.push(
      masterId !== undefined
        ? or(
            sql`EXISTS (SELECT 1 FROM ${bookingMasters} WHERE ${bookingMasters.bookingId} = ${bookings.id} AND ${bookingMasters.masterId} = ${masterId})`,
            snapshotMatch,
          )
        : snapshotMatch,
    )
  }
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

  return { items: await withLiveMasterNames(items), total: countRow?.count ?? 0 }
}
