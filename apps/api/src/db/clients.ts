import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { normalizeCarKey } from '@detailing-admin/shared/car'
import { normalizePhone } from '@detailing-admin/shared/phone'
import type { Car, CarInput, ClientStats } from '@detailing-admin/shared/client'
import { getDb } from './client.js'
import { listCarsByClient, syncClientCars } from './client-cars.js'
import { REVENUE_READINESS } from './analytics.js'
import { bookings, clientCars, clients, type Client } from './schema.js'

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
  /** Свободный поиск по имени/телефону/машине. Похожий на телефон запрос нормализуется
   * в E.164 перед сравнением с сохраненным (E.164) телефоном; ветка машин сравнивает
   * марку/модель и госномер в `client_cars`. */
  q?: string
  /** Столбец сортировки. По умолчанию — имя. */
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
    // Машины лежат в дочерней таблице с *нормализованным* ключом, поэтому запрос
    // перед сравнением нормализуется так же — госномер хранится без пробелов,
    // и сырой «А 123 АА 77» никогда не нашел бы «А123АА77».
    const carLike = `%${normalizeCarKey(q)}%`
    const plateLike = `%${normalizeCarKey(q, true)}%`
    where = or(
      ilike(clients.name, textLike),
      ilike(clients.phone, phoneLike),
      sql`EXISTS (SELECT 1 FROM ${clientCars} WHERE ${clientCars.clientId} = ${clients.id} AND (${clientCars.makeModel} ILIKE ${carLike} OR ${clientCars.plate} ILIKE ${plateLike}))`,
    )
  }

  const direction = p.dir === 'desc' ? desc : asc
  let orderBy
  if (p.sort === 'phone') {
    orderBy = [direction(clients.phone)]
  } else if (p.sort === 'createdAt') {
    orderBy = [direction(clients.createdAt)]
  } else {
    // Пустые имена всегда идут последними (при любом направлении), как в
    // сортировке collator в UI; затем по имени в запрошенном направлении.
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
 * Upsert клиента по телефону. Вызывающий код должен передать уже нормализованный
 * телефон E.164 (или пустую строку — пустые телефоны пропускаются, т. к. телефон —
 * естественный ключ). Пустой входящий `name` никогда не затирает существующее непустое имя.
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

// Возвращает сохраненного клиента вместе с его актуальными машинами (после синхронизации),
// чтобы маршрут мог вернуть согласованный набор обратно в диалог.
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
  const [row] = await db.update(clients).set({ phone, name }).where(eq(clients.id, id)).returning()
  if (!row) throw new ClientError('not_found')
  await syncClientCars(row.id, cars)
  return { client: row, cars: await listCarsByClient(row.id) }
}

export async function getClientById(id: string): Promise<Client | null> {
  const db = getDb()
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
  return row ?? null
}

export async function getClientByPhone(phone: string): Promise<Client | null> {
  const db = getDb()
  const [row] = await db.select().from(clients).where(eq(clients.phone, phone)).limit(1)
  return row ?? null
}

// Агрегаты за все время только по «Выдана» для карточки клиента. Тот же предикат
// REVENUE_READINESS, что в аналитике (а не литерал, захардкоженный дважды), но без окна периода.
// postgres-js возвращает SUM/COUNT строками → Number(); MAX/MIN(date_from) приходят
// как 'YYYY-MM-DD' (или null). Оговорка: date_from — плановая дата услуги, а не факт
// выдачи, поэтому MAX среди «Выдана» может прийтись на будущую/многодневную дату начала —
// то же приближение, которое принимает аналитика при группировке по date_from.
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
  // На этого клиента еще ссылается FK записи (bookings.client_id) — Postgres
  // отклонил бы удаление. Отказываем явно, чтобы маршрут мог вернуть 409, а не
  // общий 500; зеркало записей сохраняется намеренно.
  const [linked] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.clientId, id))
    .limit(1)
  if (linked) throw new ClientError('has_bookings')
  const result = await db.delete(clients).where(eq(clients.id, id)).returning({ id: clients.id })
  if (result.length === 0) throw new ClientError('not_found')
}
