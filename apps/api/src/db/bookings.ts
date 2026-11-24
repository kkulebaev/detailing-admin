import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { BookingServiceLine, Booking as WireBooking } from '@detailing-admin/shared/booking'
import type { BookingRow } from '@detailing-admin/shared/booking-row'
import { joinCar } from '@detailing-admin/shared/car'
import { ddmmyyyyToIso } from '@detailing-admin/shared/date'
import { normalizePhone } from '@detailing-admin/shared/phone'
import type { Readiness } from '@detailing-admin/shared/enums'
import type { BookingAuditAction } from '@detailing-admin/shared/booking-audit'
import { getDb } from './client.js'
import { resolveMasterIds } from './masters.js'
import {
  auditLog,
  bookingMasters,
  bookingServices,
  bookings,
  clientCars,
  clients,
  masters,
  services as pricelistServices,
  type AuditLogRow,
  type Booking,
  type BookingSnapshot,
  type NewBooking,
} from './schema.js'
import { baseLogger } from '../log.js'
import {
  BOOKING_ENTITY,
  diffBookings,
  recordBookingAudit,
  type AuditActor,
  type Tx,
} from './audit.js'

/** Контекст конкретной записи, которого нет в wire-booking: ключ идемпотентности,
 * связанный клиент (null при пустом телефоне) и координаты в Sheets, которые вернул
 * только что прошедший append. */
export interface BookingWriteMeta {
  idempotencyKey: string
  clientId: string | null
  // Производная id-связь с нормализованной строкой машины клиента; определяется в маршруте
  // (где уже идет прием машины), чтобы insert не делал upsert повторно. null, если
  // не определена, — главной остается строка-снимок `car`.
  carId: string | null
  sheetRow: number | null
  sheetRange: string | null
  // Нет у seed-скриптов: им некого записывать в журнал.
  actor?: AuditActor
}

/** Редактируемые пользователем столбцы записи (все, кроме внутренних связей
 * идемпотентности/клиента/таблицы). Общие для insert и update, чтобы оба одинаково
 * отображали wire-booking. */
function mapEditableFields(b: WireBooking) {
  return {
    name: b.name,
    phone: b.phone,
    // Зеркало bookings.car хранит склеенную строку (марка/модель + номер),
    // как раньше писала форма — единый формат через joinCar (см. shared/car.ts).
    car: joinCar(b.car, b.plate),
    service: b.service,
    note: b.note,
    // В wire-типе `amount` — это `'' | number`: refine схемы гарантирует число в
    // рантайме, но не сужает статический тип. Ветка '' здесь недостижима
    // (валидация отклоняет ее до запуска обработчика).
    amount: typeof b.amount === 'number' ? b.amount : 0,
    amountFormula: b.amountFormula ?? null,
    discount: b.discount ?? 0,
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

/** Строки связующей таблицы для мастеров, у которых нашелся id, дедуплицированные по id
 * (у двух разных имен не может быть общего id, но в снимке имя может встретиться дважды —
 * позицию получает первое вхождение). `position` — индекс имени в массиве снимка, чтобы
 * сторона чтения могла наложить актуальное имя на `master[i]`. Ненайденное имя
 * пропускается — id-связь намеренно частичная. */
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

/** Накладывает актуальные имена мастеров на страницу строк зеркала. Столбцы-снимки
 * (`master text[]`, `responsible`) остаются главной записью «как записано» и служат
 * запасным вариантом; где есть id-связь, побеждает *текущее* имя мастера из
 * `masters` — так переименование мастера отражается во всей истории.
 *
 * Для каждой строки: `master[i]` становится актуальным именем, если строка связующей
 * таблицы закреплена за `position === i`, иначе — имя из снимка (ненайденный / удаленный /
 * старый слот); то же для `responsible` через `responsibleId`. Два пакетных запроса на всю
 * страницу, а не на каждую строку. */
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

/** Строки услуг для вставки. Связь с услугой, которой уже нет в прайсе (удалили, пока
 * форма была открыта, или удалили до восстановления записи), обнуляется: иначе FK
 * уронил бы всю запись, а строка и так держится на снимке. */
async function serviceLineRows(db: Tx, bookingId: string, lines: BookingServiceLine[]) {
  const ids = [...new Set(lines.map((l) => l.serviceId).filter((v): v is number => v != null))]
  const live = new Set(
    ids.length > 0
      ? (
          await db
            .select({ id: pricelistServices.id })
            .from(pricelistServices)
            .where(inArray(pricelistServices.id, ids))
        ).map((s) => s.id)
      : [],
  )
  return lines.map((l, position) => ({
    bookingId,
    position,
    serviceId: l.serviceId != null && live.has(l.serviceId) ? l.serviceId : null,
    section: l.section,
    name: l.name,
    price: l.price,
    quantity: l.quantity,
  }))
}

async function insertServiceLines(tx: Tx, bookingId: string, lines: BookingServiceLine[]) {
  if (lines.length === 0) return
  await tx.insert(bookingServices).values(await serviceLineRows(tx, bookingId, lines))
}

async function loadServiceLines(
  db: Pick<Tx, 'select'>,
  bookingIds: string[],
): Promise<Map<string, BookingServiceLine[]>> {
  const byBooking = new Map<string, BookingServiceLine[]>()
  if (bookingIds.length === 0) return byBooking
  const rows = await db
    .select()
    .from(bookingServices)
    .where(inArray(bookingServices.bookingId, bookingIds))
    .orderBy(asc(bookingServices.bookingId), asc(bookingServices.position))
  for (const { bookingId, position: _position, ...line } of rows) {
    const list = byBooking.get(bookingId) ?? []
    list.push(line)
    byBooking.set(bookingId, list)
  }
  return byBooking
}

/** Строка `bookings` с автором и услугами для показа в списке. `createdBy: null` —
 * автора нет в журнале: запись старше журнала или пришла из seed-скрипта. */
export type BookingWithCreator = Booking & {
  createdBy: string | null
  services: BookingServiceLine[]
}

/** Автор берется из журнала, а не из столбца `bookings`: после удаления и
 * восстановления строка вставляется заново, а запись `create` в журнале остается. */
async function withCreators(rows: Booking[]): Promise<(Booking & { createdBy: string | null })[]> {
  if (rows.length === 0) return []
  const entries = await getDb()
    .select({
      entityId: auditLog.entityId,
      actorLogin: auditLog.actorLogin,
      actorName: auditLog.actorName,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, BOOKING_ENTITY),
        eq(auditLog.action, 'create'),
        inArray(
          auditLog.entityId,
          rows.map((r) => r.id),
        ),
      ),
    )
  const creators = new Map(entries.map((e) => [e.entityId, e.actorName || e.actorLogin]))
  return rows.map((r) => ({ ...r, createdBy: creators.get(r.id) ?? null }))
}

/** Обогащение при любом чтении записей: актуальные имена мастеров, автор и услуги. */
async function enrichForRead(rows: Booking[]): Promise<BookingWithCreator[]> {
  const withNames = await withCreators(await withLiveMasterNames(rows))
  const lines = await loadServiceLines(
    getDb(),
    rows.map((r) => r.id),
  )
  return withNames.map((r) => ({ ...r, services: lines.get(r.id) ?? [] }))
}

/** Переводит сохраненную строку `bookings` в wire-форму. Отбрасывает все три внутренние
 * id-связи (`idempotencyKey`, `responsibleId`, `carId` — в wire-ответ они никогда не входят)
 * и сериализует `createdAt`. `amount`/`amountFormula` только для админа: включаются лишь
 * при `includeAmount` — вызывающий не-админ обязан передать `false`, чтобы денежные
 * поля в ответе отсутствовали (undefined). */
export function toBookingRow(
  row: BookingWithCreator,
  opts: { includeAmount: boolean },
): BookingRow {
  const {
    idempotencyKey: _idempotencyKey,
    responsibleId: _responsibleId,
    carId: _carId,
    createdAt,
    amount,
    amountFormula,
    discount,
    services,
    ...rest
  } = row
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    ...(opts.includeAmount ? { amount, amountFormula, discount, services } : {}),
  }
}

/** Полная история записей одного клиента, новые первыми. Берет `limit + 1` строк, чтобы
 * вызывающий мог отметить усечение без второго COUNT; `bookings_client_id_idx` делает
 * это дешево. Актуальные имена мастеров накладываются, как на любом пути чтения. */
export async function listBookingsByClientId(
  clientId: string,
  limit: number,
): Promise<BookingWithCreator[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.clientId, clientId))
    .orderBy(desc(bookings.dateFrom), desc(bookings.createdAt))
    .limit(limit + 1)
  return enrichForRead(rows)
}

/** Best-effort вставка в зеркало. Идемпотентна по `idempotencyKey`: дубль ключа —
 * no-op (возвращает false), а не ошибка: повтор клиента после TTL не должен
 * создать вторую строку. Переводит имена мастеров/ответственного в id: `responsible_id`
 * пишется атомарно со строкой; связующая таблица — отдельный шаг, который выполняется
 * только при реальной вставке (не при no-op из-за конфликта), так что повтор не добавляет
 * связей. Сбой связующей таблицы уходит в best-effort catch маршрута (запись все равно
 * попадает в Sheets и возвращает 201; связь восстановит backfill). */
export async function insertBooking(b: WireBooking, meta: BookingWriteMeta): Promise<boolean> {
  const db = getDb()
  const ids = await resolveMasterIds([...b.master, b.responsible])
  const responsibleId = ids.get(b.responsible.trim()) ?? null
  const bookingId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(bookings)
      .values(bookingToDbRow(b, meta, responsibleId))
      .onConflictDoNothing({ target: bookings.idempotencyKey })
      .returning({ id: bookings.id })
    if (inserted.length === 0) return null
    // Точка сохранения: сбой строк услуг (например, услугу удалили из прайса между
    // проверкой и вставкой) не должен утянуть за собой саму строку зеркала.
    try {
      await tx.transaction((sp) => insertServiceLines(sp, inserted[0].id, b.services ?? []))
    } catch (err) {
      baseLogger.warn(
        {
          event: 'booking.services_insert_failed',
          booking_id: inserted[0].id,
          message: err instanceof Error ? err.message : String(err),
        },
        'Booking service lines insert failed — booking mirrored without lines',
      )
    }
    if (meta.actor) await recordBookingAudit(tx, meta.actor, inserted[0].id, 'create')
    return inserted[0].id
  })
  if (bookingId === null) return false

  const masterRows = matchedMasterRows(bookingId, b.master, ids)
  if (masterRows.length > 0) {
    await db.insert(bookingMasters).values(masterRows).onConflictDoNothing()
  }
  return true
}

/** Блокирует строку до конца транзакции, чтобы снимок «было» в журнале совпадал с тем,
 * что реально перезаписали, даже при двух одновременных правках. */
async function lockBooking(tx: Tx, id: string): Promise<Booking | undefined> {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update')
  return row
}

/** Обновляет редактируемые поля записи (и заново связанных клиента + машину). Ключ
 * идемпотентности и связь с Sheets не трогает. Возвращает обновленную строку или null,
 * если записи с таким id нет. `car_id` (определяется в маршруте только чтением) и
 * `responsible_id` обновляются атомарно вместе
 * с полями; связующая таблица переписывается (delete + повторный insert) отдельным
 * best-effort шагом, сбой которого проглатывается — PATCH все равно возвращает 200
 * (Sheets — источник истины; id-связь производная и восстанавливается backfill'ом). */
export async function updateBooking(
  id: string,
  b: WireBooking,
  clientId: string | null,
  carId: string | null,
  actor: AuditActor,
): Promise<BookingWithCreator | null> {
  const db = getDb()
  const ids = await resolveMasterIds([...b.master, b.responsible])
  const responsibleId = ids.get(b.responsible.trim()) ?? null
  const row = await db.transaction(async (tx) => {
    const before = await lockBooking(tx, id)
    if (!before) return null
    const fields = mapEditableFields(b)
    // Диалог правки не знает формулу (она собирается из прайса только в форме записи)
    // и не присылает ее; без этого каждое сохранение стирало бы формулу. Она верна, лишь
    // пока сумма прежняя: ручная правка суммы делает ее устаревшей.
    if (b.amountFormula === undefined) {
      fields.amountFormula = fields.amount === before.amount ? before.amountFormula : null
    }
    if (b.discount === undefined) fields.discount = before.discount
    if (b.services !== undefined) {
      await tx.delete(bookingServices).where(eq(bookingServices.bookingId, id))
      await insertServiceLines(tx, id, b.services)
    }
    const [after] = await tx
      .update(bookings)
      .set({ ...fields, clientId, carId, responsibleId })
      .where(eq(bookings.id, id))
      .returning()
    const changes = diffBookings(before, after)
    if (changes.length > 0) await recordBookingAudit(tx, actor, id, 'update', { changes })
    return after
  })
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
  const [enriched] = await enrichForRead([row])
  return enriched
}

/** Обновляет только готовность записи (быстрая смена статуса в строке). Возвращает
 * обновленную строку или null, если записи с таким id нет. */
export async function updateBookingReadiness(
  id: string,
  readiness: Readiness | '',
  actor: AuditActor,
): Promise<BookingWithCreator | null> {
  const db = getDb()
  const row = await db.transaction(async (tx) => {
    const before = await lockBooking(tx, id)
    if (!before) return null
    const [after] = await tx
      .update(bookings)
      .set({ readiness })
      .where(eq(bookings.id, id))
      .returning()
    const changes = diffBookings(before, after)
    if (changes.length > 0) await recordBookingAudit(tx, actor, id, 'update', { changes })
    return after
  })
  if (!row) return null
  const [enriched] = await enrichForRead([row])
  return enriched
}

/** Удаляет запись по id, сохраняя в журнал ее полный снимок в той же транзакции:
 * без снимка удаление не проходит. Возвращает false, если строка не нашлась. */
export async function deleteBooking(id: string, actor: AuditActor): Promise<boolean> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const before = await lockBooking(tx, id)
    if (!before) return false
    const links = await tx
      .select({ masterId: bookingMasters.masterId, position: bookingMasters.position })
      .from(bookingMasters)
      .where(eq(bookingMasters.bookingId, id))
    const lines = await loadServiceLines(tx, [id])
    const snapshot: BookingSnapshot = {
      booking: { ...before, createdAt: before.createdAt.toISOString() },
      masters: links,
      services: lines.get(id) ?? [],
    }
    await tx.delete(bookings).where(eq(bookings.id, id))
    await recordBookingAudit(tx, actor, id, 'delete', { snapshot })
    return true
  })
}

export type RestoreResult =
  | { ok: true; booking: BookingWithCreator }
  | { ok: false; reason: 'not_found' | 'already_restored' }

/** Возвращает удаленную запись из последнего снимка с тем же id. Клиент, машина или
 * мастер из снимка за это время могли исчезнуть: такие связи обнуляются (снимки-строки
 * остаются), как и при любом другом сбое производных связей. */
export async function restoreBooking(id: string, actor: AuditActor): Promise<RestoreResult> {
  const db = getDb()
  type Restored = { ok: true; booking: Booking } | Extract<RestoreResult, { ok: false }>
  const restored = await db.transaction(async (tx): Promise<Restored> => {
    const [entry] = await tx
      .select({ snapshot: auditLog.snapshot })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, BOOKING_ENTITY),
          eq(auditLog.entityId, id),
          eq(auditLog.action, 'delete'),
        ),
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(1)
    if (!entry?.snapshot) return { ok: false, reason: 'not_found' }
    const snap = entry.snapshot
    const b = snap.booking
    const [client] = b.clientId
      ? await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId))
      : []
    const [car] = b.carId
      ? await tx.select({ id: clientCars.id }).from(clientCars).where(eq(clientCars.id, b.carId))
      : []
    const clientId = client?.id ?? null
    const carId = car?.id ?? null
    const masterIds = [
      ...new Set([
        ...snap.masters.map((m) => m.masterId),
        ...(b.responsibleId != null ? [b.responsibleId] : []),
      ]),
    ]
    const liveMasters = new Set(
      masterIds.length > 0
        ? (
            await tx.select({ id: masters.id }).from(masters).where(inArray(masters.id, masterIds))
          ).map((m) => m.id)
        : [],
    )
    const responsibleId =
      b.responsibleId != null && liveMasters.has(b.responsibleId) ? b.responsibleId : null

    // Без target: конфликт и по id (уже восстановлена), и по idempotencyKey (тот же
    // ключ после удаления успел создать новую запись) значит одно — вернуть некуда.
    const [row] = await tx
      .insert(bookings)
      .values({ ...b, clientId, carId, responsibleId, createdAt: new Date(b.createdAt) })
      .onConflictDoNothing()
      .returning()
    if (!row) return { ok: false, reason: 'already_restored' }

    const links = snap.masters.filter((m) => liveMasters.has(m.masterId))
    if (links.length > 0) {
      await tx
        .insert(bookingMasters)
        .values(links.map((m) => ({ bookingId: id, ...m })))
        .onConflictDoNothing()
    }
    await insertServiceLines(tx, id, snap.services ?? [])
    await recordBookingAudit(tx, actor, id, 'restore')
    return { ok: true, booking: row }
  })
  if (!restored.ok) return restored
  const [enriched] = await enrichForRead([restored.booking])
  return { ok: true, booking: enriched }
}

/** История изменений записи по порядку. Работает и для удаленной записи. */
export async function listBookingHistory(id: string): Promise<AuditLogRow[]> {
  const db = getDb()
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, BOOKING_ENTITY), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id))
}

export interface BookingJournalRow {
  entry: AuditLogRow
  booking: Pick<Booking, 'name' | 'car' | 'dateFrom' | 'dateTo' | 'timeFrom'> | null
  deleted: boolean
}

/** Общий журнал по всем записям, свежие первыми. Берет `limit + 1` строк, чтобы
 * вызывающий узнал о продолжении без COUNT по всему журналу. Сводка записи — из
 * таблицы, а для отсутствующей записи — из последнего снимка ее удаления. */
export async function listBookingJournal(p: {
  limit: number
  offset: number
  actorId?: string
  action?: BookingAuditAction
}): Promise<BookingJournalRow[]> {
  const { limit, offset } = p
  const db = getDb()
  const entries = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, BOOKING_ENTITY),
        p.actorId ? eq(auditLog.actorId, p.actorId) : undefined,
        p.action ? eq(auditLog.action, p.action) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1)
    .offset(offset)
  if (entries.length === 0) return []

  const ids = [...new Set(entries.map((e) => e.entityId))]
  const summaryCols = {
    id: bookings.id,
    name: bookings.name,
    car: bookings.car,
    dateFrom: bookings.dateFrom,
    dateTo: bookings.dateTo,
    timeFrom: bookings.timeFrom,
  }
  const live = await db
    .select(summaryCols)
    .from(bookings)
    // entity_id — текст, а сравнение uuid с не-uuid строкой упало бы, поэтому приводим id.
    .where(inArray(sql`${bookings.id}::text`, ids))
  const summaries = new Map<string, BookingJournalRow['booking']>(
    live.map(({ id, ...rest }) => [id, rest]),
  )

  const missing = ids.filter((id) => !summaries.has(id))
  const deleted = new Set(missing)
  if (missing.length > 0) {
    const snaps = await db
      .selectDistinctOn([auditLog.entityId], {
        entityId: auditLog.entityId,
        snapshot: auditLog.snapshot,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, BOOKING_ENTITY),
          eq(auditLog.action, 'delete'),
          inArray(auditLog.entityId, missing),
        ),
      )
      .orderBy(auditLog.entityId, desc(auditLog.at), desc(auditLog.id))
    for (const s of snaps) {
      const b = s.snapshot?.booking
      if (b) {
        summaries.set(s.entityId, {
          name: b.name,
          car: b.car,
          dateFrom: b.dateFrom,
          dateTo: b.dateTo,
          timeFrom: b.timeFrom,
        })
      }
    }
  }

  return entries.map((entry) => ({
    entry,
    booking: summaries.get(entry.entityId) ?? null,
    deleted: deleted.has(entry.entityId),
  }))
}

export interface DeletedBookingEntry {
  booking: BookingWithCreator
  deletedAt: Date
  deletedBy: string
}

/** Корзина: по последнему удалению каждой записи, которая сейчас отсутствует в
 * `bookings` (восстановленные выпадают сами), свежие первыми. */
export async function listDeletedBookings(limit: number): Promise<DeletedBookingEntry[]> {
  const db = getDb()
  const latest = db
    .selectDistinctOn([auditLog.entityId])
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, BOOKING_ENTITY),
        eq(auditLog.action, 'delete'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(bookings)
            .where(sql`${bookings.id}::text = ${auditLog.entityId}`),
        ),
      ),
    )
    .orderBy(auditLog.entityId, desc(auditLog.at), desc(auditLog.id))
    .as('latest')
  const rows = await db.select().from(latest).orderBy(desc(latest.at)).limit(limit)

  const items = rows.flatMap((r) => {
    const snap = r.snapshot
    if (!snap) return []
    // Старые снимки сделаны до столбца `discount`.
    const booking: Booking = {
      ...snap.booking,
      discount: snap.booking.discount ?? 0,
      createdAt: new Date(snap.booking.createdAt),
    }
    return [
      {
        booking,
        services: snap.services ?? [],
        deletedAt: r.at,
        deletedBy: r.actorName || r.actorLogin,
      },
    ]
  })
  const enriched = await enrichForRead(items.map((i) => i.booking))
  // Строки услуг удаленной записи ушли каскадом вместе с ней — берем их из снимка.
  return items.map(({ services, ...item }, i) => ({
    ...item,
    booking: { ...enriched[i], services },
  }))
}

export interface ListBookingsParams {
  limit: number
  offset: number
  /** ISO `YYYY-MM-DD`; оставляет строки, у которых `dateFrom` >= этого значения. */
  dateFrom?: string
  /** ISO `YYYY-MM-DD`; оставляет строки, у которых `dateFrom` <= этого значения. */
  dateTo?: string
  /** Любой из мастеров; пустой список — без фильтра. */
  master?: readonly string[]
  /** Любой из статусов, `''` — без статуса; пустой список — без фильтра. */
  readiness?: readonly (Readiness | '')[]
  /** Свободный поиск по имени/машине/телефону. Похожий на телефон запрос нормализуется
   * в E.164 перед сравнением с сохраненным (E.164) телефоном. */
  q?: string
  /** Направление для `dateFrom`, затем `timeFrom`; ничьи разрешает `createdAt` в том же
   * направлении. `timeFrom` — `ЧЧ:ММ` с ведущим нулем, поэтому строковый порядок совпадает
   * со временным. */
  sort?: 'asc' | 'desc'
}

export async function listBookings(
  p: ListBookingsParams,
): Promise<{ items: BookingWithCreator[]; total: number }> {
  const db = getDb()

  const conds = []
  if (p.dateFrom) conds.push(gte(bookings.dateFrom, p.dateFrom))
  if (p.dateTo) conds.push(lte(bookings.dateFrom, p.dateTo))
  // Фильтруем по *текущим* именам мастеров: переводим их в id и сверяем со связующей
  // таблицей, чтобы записи находились и после переименования мастера. Для старых строк
  // без id-связи откатываемся к пересечению со снимком (`master && names`) (и это
  // единственная ветка, когда ни одному имени не соответствует id).
  // TODO: проверять master/responsible по актуальному списку при записи
  // (отклонять неизвестные имена), чтобы каждая запись всегда разрешалась в id, — тогда
  // этот запасной `= ANY(master)` и запасной вариант по слотам снимка в
  // withLiveMasterNames станут мертвыми, и их можно будет убрать ради чистого фильтра по id.
  // Предусловие: сначала дать маркеру отмены (сейчас это "Отмена", засунутая в
  // `responsible`) свое поле/статус, иначе проверка только по мастерам его отклонит.
  const masterNames = [...new Set((p.master ?? []).map((n) => n.trim()).filter(Boolean))]
  if (masterNames.length) {
    const masterIds = [...(await resolveMasterIds(masterNames)).values()]
    const snapshotMatch = arrayOverlaps(bookings.master, masterNames)
    conds.push(
      masterIds.length
        ? or(
            sql`EXISTS (SELECT 1 FROM ${bookingMasters} WHERE ${bookingMasters.bookingId} = ${bookings.id} AND ${inArray(bookingMasters.masterId, masterIds)})`,
            snapshotMatch,
          )
        : snapshotMatch,
    )
  }
  if (p.readiness?.length) conds.push(inArray(bookings.readiness, [...p.readiness]))

  const q = p.q?.trim()
  if (q) {
    const textLike = `%${q}%`
    // Телефон хранится в E.164, а сотрудники вводят `8XXX`; нормализуем, чтобы поиск
    // по телефону все равно находил. На не-телефоне normalizePhone бросает ошибку — тогда
    // откатываемся к сравнению по сырому тексту.
    let phoneLike = textLike
    try {
      const normalized = normalizePhone(q)
      if (normalized) phoneLike = `%${normalized}%`
    } catch {
      // Не телефон — оставляем текстовый шаблон.
    }
    conds.push(
      or(
        ilike(bookings.name, textLike),
        ilike(bookings.car, textLike),
        ilike(bookings.phone, phoneLike),
      ),
    )
  }

  const where = conds.length ? and(...conds) : undefined
  const dir = p.sort === 'asc' ? asc : desc

  const items = await db
    .select()
    .from(bookings)
    .where(where)
    .orderBy(dir(bookings.dateFrom), dir(bookings.timeFrom), dir(bookings.createdAt))
    .limit(p.limit)
    .offset(p.offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(where)

  return { items: await enrichForRead(items), total: countRow?.count ?? 0 }
}
