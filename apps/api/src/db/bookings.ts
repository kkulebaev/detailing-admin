import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
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

/** Контекст конкретной записи, которого нет в wire-booking: ключ идемпотентности,
 * связанный клиент (null при пустом телефоне) и координаты в Sheets, которые вернул
 * только что прошедший append. */
export interface BookingWriteMeta {
  idempotencyKey: string
  clientId: string | null
  // Производная id-связь с нормализованной строкой машины клиента; определяется в маршруте
  // (где уже идёт приём машины), чтобы insert не делал upsert повторно. null, если
  // не определена, — главной остаётся строка-снимок `car`.
  carId: string | null
  sheetRow: number | null
  sheetRange: string | null
}

/** Редактируемые пользователем столбцы записи (всё, кроме внутренних связей
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
    // (валидация отклоняет её до запуска обработчика).
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

/** Строки связующей таблицы для мастеров, у которых нашёлся id, дедуплицированные по id
 * (у двух разных имён не может быть общего id, но в снимке имя может встретиться дважды —
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
 * таблицы закреплена за `position === i`, иначе — имя из снимка (ненайденный / удалённый /
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

/** Переводит сохранённую строку `bookings` в wire-форму. Отбрасывает все три внутренние
 * id-связи (`idempotencyKey`, `responsibleId`, `carId` — в wire-ответ они никогда не входят)
 * и сериализует `createdAt`. `amount`/`amountFormula` только для админа: включаются лишь
 * при `includeAmount` — вызывающий не-админ обязан передать `false`, чтобы денежные
 * поля в ответе отсутствовали (undefined). */
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

/** Полная история записей одного клиента, новые первыми. Берёт `limit + 1` строк, чтобы
 * вызывающий мог отметить усечение без второго COUNT; `bookings_client_id_idx` делает
 * это дёшево. Актуальные имена мастеров накладываются, как на любом пути чтения. */
export async function listBookingsByClientId(clientId: string, limit: number): Promise<Booking[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.clientId, clientId))
    .orderBy(desc(bookings.dateFrom), desc(bookings.createdAt))
    .limit(limit + 1)
  return withLiveMasterNames(rows)
}

/** Best-effort вставка в зеркало. Идемпотентна по `idempotencyKey`: дубль ключа —
 * no-op (возвращает false), а не ошибка: повтор клиента после TTL не должен
 * создать вторую строку. Переводит имена мастеров/ответственного в id: `responsible_id`
 * пишется атомарно со строкой; связующая таблица — отдельный шаг, который выполняется
 * только при реальной вставке (не при no-op из-за конфликта), так что повтор не добавляет
 * связей. Сбой связующей таблицы уходит в best-effort catch маршрута (запись всё равно
 * попадает в Sheets и возвращает 201; связь восстановит backfill). */
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

/** Обновляет редактируемые поля записи (и заново связанных клиента + машину). Ключ
 * идемпотентности и связь с Sheets не трогает. Возвращает обновлённую строку или null,
 * если записи с таким id нет. `car_id` (определяется в маршруте только чтением) и
 * `responsible_id` обновляются атомарно вместе
 * с полями; связующая таблица переписывается (delete + повторный insert) отдельным
 * best-effort шагом, сбой которого проглатывается — PATCH всё равно возвращает 200
 * (Sheets — источник истины; id-связь производная и восстанавливается backfill'ом). */
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

/** Обновляет только готовность записи (быстрая смена статуса в строке). Возвращает
 * обновлённую строку или null, если записи с таким id нет. */
export async function updateBookingReadiness(
  id: string,
  readiness: Readiness | '',
): Promise<Booking | null> {
  const db = getDb()
  const [row] = await db.update(bookings).set({ readiness }).where(eq(bookings.id, id)).returning()
  if (!row) return null
  const [enriched] = await withLiveMasterNames([row])
  return enriched
}

/** Удаляет запись по id. Возвращает false, если строка не нашлась. */
export async function deleteBooking(id: string): Promise<boolean> {
  const db = getDb()
  const res = await db.delete(bookings).where(eq(bookings.id, id)).returning({ id: bookings.id })
  return res.length > 0
}

export interface ListBookingsParams {
  limit: number
  offset: number
  /** ISO `YYYY-MM-DD`; оставляет строки, у которых `dateFrom` >= этого значения. */
  dateFrom?: string
  /** ISO `YYYY-MM-DD`; оставляет строки, у которых `dateFrom` <= этого значения. */
  dateTo?: string
  master?: string
  readiness?: Readiness
  /** Свободный поиск по имени/машине/телефону. Похожий на телефон запрос нормализуется
   * в E.164 перед сравнением с сохранённым (E.164) телефоном. */
  q?: string
  /** Направление для `dateFrom`; ничьи разрешает `createdAt` в том же направлении. */
  sort?: 'asc' | 'desc'
}

export async function listBookings(
  p: ListBookingsParams,
): Promise<{ items: Booking[]; total: number }> {
  const db = getDb()

  const conds = []
  if (p.dateFrom) conds.push(gte(bookings.dateFrom, p.dateFrom))
  if (p.dateTo) conds.push(lte(bookings.dateFrom, p.dateTo))
  // Фильтруем по *текущему* имени мастера: переводим его в id и сверяем со связующей
  // таблицей, чтобы записи находились и после переименования мастера. Для старых строк
  // без id-связи откатываемся к проверке вхождения в снимок (`= ANY(master)`) (и это
  // единственная ветка, когда имени не соответствует ни один id).
  // TODO: проверять master/responsible по актуальному списку при записи
  // (отклонять неизвестные имена), чтобы каждая запись всегда разрешалась в id, — тогда
  // этот запасной `= ANY(master)` и запасной вариант по слотам снимка в
  // withLiveMasterNames станут мёртвыми, и их можно будет убрать ради чистого фильтра по id.
  // Предусловие: сначала дать маркеру отмены (сейчас это "Отмена", засунутая в
  // `responsible`) своё поле/статус, иначе проверка только по мастерам его отклонит.
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
    // Телефон хранится в E.164, а сотрудники вводят `8XXX`; нормализуем, чтобы поиск
    // по телефону всё равно находил. На не-телефоне normalizePhone бросает ошибку — тогда
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
    .orderBy(dir(bookings.dateFrom), dir(bookings.createdAt))
    .limit(p.limit)
    .offset(p.offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(where)

  return { items: await withLiveMasterNames(items), total: countRow?.count ?? 0 }
}
