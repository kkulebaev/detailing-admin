import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  isNotNull,
  lte,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { AnalyticsGranularity } from '@detailing-admin/shared'
import { getDb, type Db } from './client.js'
import { bookings, clients } from './schema.js'

// Выручка — это деньги по факту выдачи: учитываются ТОЛЬКО записи со статусом «Выдана».
// Это единственный позитивный фильтр за total/completedCount/series.revenue/prevTotal и
// обеими метриками топ-клиентов. Точка расширения — добавь сюда статус (один литерал),
// и тест toSQL обновится вместе с ним. Множество держится позитивным, а не негативным
// «всё, кроме отмен», чтобы «Оплачено»/«Не оплачено» и т. п. никогда не просочились в деньги.
export const REVENUE_READINESS = ['Выдана'] as const

// «Клиент не пришёл». Используется ТОЛЬКО для определения «визита» в удержании: визит —
// любая запись НЕ из этого множества, намеренно шире, чем «Выдана», чтобы будущий или
// идущий визит всё равно отмечал, что клиент появлялся. Три разных знаменателя
// специально живут в одном ответе: bookingsCount/series.count = COUNT(*) по ВСЕМ
// статусам (объём), удержание считает визиты (NOT IN это множество), выручка считает
// только «Выдана». Не путай их.
export const NON_VISIT_READINESS = ['Отмена', 'Не приехал'] as const

// Позитивный предикат «Выдана». Пока множество из одного элемента, рендерится как
// `readiness = 'Выдана'` (SQL — и тест — остаются равенством); форма `in (...)`
// появится, только если константа разрастётся.
const revenueCond: SQL =
  REVENUE_READINESS.length === 1
    ? sql`${bookings.readiness} = ${REVENUE_READINESS[0]}`
    : sql`${bookings.readiness} in ${sql.join(
        REVENUE_READINESS.map((s) => sql`${s}`),
        sql`, `,
      )}`

// Включительный диапазон по `date_from`. Многодневные записи попадают в корзину только
// по дню начала (`date_to` в v1 игнорируется) — запись целиком ложится в корзину
// своего первого дня. `date_from` имеет тип `date` (без времени/TZ), поэтому
// `date_trunc`/`to_char` ниже не зависят от часового пояса и детерминированы.
function dateRange(fromIso: string, toIso: string): SQL {
  return and(gte(bookings.dateFrom, fromIso), lte(bookings.dateFrom, toIso))!
}

// Один ключ корзины на гранулярность (см. план, §«Бакетинг»). `week` усекает до
// ISO-недели (понедельник); `month` сворачивает в `YYYY-MM`; `day` — ISO-дата.
function bucketExpr(granularity: AnalyticsGranularity): SQL<string> {
  if (granularity === 'week') {
    return sql<string>`to_char(date_trunc('week', ${bookings.dateFrom}::date), 'YYYY-MM-DD')`
  }
  if (granularity === 'month') {
    return sql<string>`to_char(${bookings.dateFrom}::date, 'YYYY-MM')`
  }
  return sql<string>`to_char(${bookings.dateFrom}::date, 'YYYY-MM-DD')`
}

export interface RangeParams {
  fromIso: string
  toIso: string
}

export interface SeriesParams extends RangeParams {
  granularity: AnalyticsGranularity
}

// Итоги периода за один проход. `noClientCount` (записи без связанного клиента) едет
// здесь же — это число записей периода, а не клиентов, поэтому оно отделено
// от запроса удержания и его новых/вернувшихся клиентов.
export function buildTotalsQuery(db: Db, p: RangeParams) {
  return db
    .select({
      total: sql<string>`coalesce(sum(${bookings.amount}) filter (where ${revenueCond}), 0)`,
      completedCount: sql<string>`count(*) filter (where ${revenueCond})`,
      bookingsCount: sql<string>`count(*)`,
      noClientCount: sql<string>`count(*) filter (where ${isNull(bookings.clientId)})`,
    })
    .from(bookings)
    .where(dateRange(p.fromIso, p.toIso))
}

// Выручка (только «Выдана») и объём (все статусы) по корзинам. GROUP BY выдаёт только
// корзины со строками — маршрут заполняет пропуски нулями, чтобы линейный график не
// сглаживал пустые периоды.
export function buildSeriesQuery(db: Db, p: SeriesParams) {
  const bucket = bucketExpr(p.granularity)
  return db
    .select({
      bucket: bucket.as('bucket'),
      revenue: sql<string>`coalesce(sum(${bookings.amount}) filter (where ${revenueCond}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(bookings)
    .where(dateRange(p.fromIso, p.toIso))
    .groupBy(bucket)
    .orderBy(bucket)
}

// Новые и вернувшиеся — по самой первой записи. `first_seen` — MIN(date_from) клиента
// по ВИЗИТАМ (readiness NOT IN NON_VISIT_READINESS) во всей таблице: клиент «новый», если
// этот первый визит попадает в период, и «вернувшийся», если он раньше периода. Оба
// счётчика — по клиентам, активным (≥1 визит) в периоде. ВАЖНО: ограничено горизонтом
// зеркала (февраль 2026) — «новый» значит «первый в нашей БД», а не по-настоящему первый визит.
export function buildRetentionQuery(db: Db, p: RangeParams) {
  const firstSeen = db.$with('first_seen').as(
    db
      .select({
        clientId: bookings.clientId,
        firstFrom: sql<string>`min(${bookings.dateFrom})`.as('first_from'),
      })
      .from(bookings)
      .where(
        and(isNotNull(bookings.clientId), notInArray(bookings.readiness, [...NON_VISIT_READINESS])),
      )
      .groupBy(bookings.clientId),
  )

  const active = db
    .selectDistinct({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        dateRange(p.fromIso, p.toIso),
        isNotNull(bookings.clientId),
        notInArray(bookings.readiness, [...NON_VISIT_READINESS]),
      ),
    )
    .as('active')

  return db
    .with(firstSeen)
    .select({
      newCount: sql<string>`count(*) filter (where ${firstSeen.firstFrom} >= ${p.fromIso})`,
      returningCount: sql<string>`count(*) filter (where ${firstSeen.firstFrom} < ${p.fromIso})`,
    })
    .from(active)
    .innerJoin(firstSeen, eq(firstSeen.clientId, active.clientId))
}

// Топ клиентов по выручке с выданных записей. Фильтр «Выдана» стоит в WHERE, а не
// в FILTER — поэтому клиент без выданных записей в периоде вовсе выпадает из
// группировки (а не всплывает строкой с sum=0, занимая место в LIMIT 10, когда
// выдач было меньше чем у 10 клиентов). Период без выдач даёт пустой топ.
// INNER JOIN по clients отбрасывает записи без клиента.
export function buildTopQuery(db: Db, p: RangeParams) {
  const sumExpr = sql<string>`coalesce(sum(${bookings.amount}), 0)`
  const visitsExpr = sql<string>`count(*)`
  return (
    db
      .select({
        clientId: bookings.clientId,
        name: clients.name,
        phone: clients.phone,
        sum: sumExpr,
        visits: visitsExpr,
      })
      .from(bookings)
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .where(and(dateRange(p.fromIso, p.toIso), revenueCond))
      .groupBy(bookings.clientId, clients.name, clients.phone)
      // Вторичный ключ детерминированно разрешает ничьи — без него при равных суммах
      // граница LIMIT 10 зависела бы от произвольного порядка строк в Postgres.
      .orderBy(desc(sumExpr), asc(bookings.clientId))
      .limit(10)
  )
}

export interface AnalyticsParams extends SeriesParams {
  prevFromIso: string
  prevToIso: string
}

// Сырые агрегаты в том виде, в каком их возвращает postgres-js, — SUM/COUNT СТРОКИ.
// Маршрут приводит каждое поле через Number() на границе ответа. @hono/zod-openapi
// НЕ валидирует ответы в рантайме, так что неприведённая строка здесь не упала бы,
// — но веб-клиент считает на этих числах (avgCheck, Δ%, repeatRate, математика
// графиков), и строковые операнды молча испортили бы результат (например, '1'+'2'='12').
export interface RawTopClient {
  clientId: string | null
  name: string
  phone: string
  sum: string
  visits: string
}

export interface RawAnalytics {
  totals: { total: string; completedCount: string; bookingsCount: string; noClientCount: string }
  prevTotal: string
  series: { bucket: string; revenue: string; count: string }[]
  retention: { newCount: string; returningCount: string }
  topBySum: RawTopClient[]
}

export async function getAnalyticsOverview(p: AnalyticsParams): Promise<RawAnalytics> {
  const db = getDb()

  const [totalsRow] = await buildTotalsQuery(db, { fromIso: p.fromIso, toIso: p.toIso })
  const [prevRow] = await buildTotalsQuery(db, { fromIso: p.prevFromIso, toIso: p.prevToIso })
  const series = await buildSeriesQuery(db, p)
  const [retentionRow] = await buildRetentionQuery(db, { fromIso: p.fromIso, toIso: p.toIso })
  const topBySum = await buildTopQuery(db, { fromIso: p.fromIso, toIso: p.toIso })

  return {
    // Агрегат без подходящих строк всё равно возвращает одну строку (с нулями из COALESCE).
    totals: totalsRow ?? {
      total: '0',
      completedCount: '0',
      bookingsCount: '0',
      noClientCount: '0',
    },
    prevTotal: prevRow?.total ?? '0',
    series,
    retention: retentionRow ?? { newCount: '0', returningCount: '0' },
    topBySum,
  }
}
