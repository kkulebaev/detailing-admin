import { and, asc, desc, eq, gte, isNull, isNotNull, lte, notInArray, sql, type SQL } from 'drizzle-orm'
import type { AnalyticsGranularity } from '@detailing-admin/shared'
import { getDb, type Db } from './client.js'
import { bookings, clients } from './schema.js'

// Revenue is money-on-delivery: ONLY bookings marked «Выдана» count. This is the
// single positive filter behind total/completedCount/series.revenue/prevTotal and
// both top-client metrics. Extension point — add a status here (one literal) and
// the toSQL test updates with it. Kept a positive set, never a "everything except
// cancellations" negative, so «Оплачено»/«Не оплачено» etc. never leak into money.
export const REVENUE_READINESS = ['Выдана'] as const

// "The client didn't show up." Used ONLY to define a retention «visit»: a visit is
// any booking NOT in this set — deliberately wider than «Выдана» so a future/
// in-progress visit still marks the client as having appeared. Three different
// denominators live in one response on purpose: bookingsCount/series.count =
// COUNT(*) over ALL statuses (volume), retention counts visits (NOT IN this set),
// revenue counts only «Выдана». Do not conflate them.
export const NON_VISIT_READINESS = ['Отмена', 'Не приехал'] as const

// Positive «Выдана» predicate. Rendered as `readiness = 'Выдана'` while the set is
// a singleton (keeps the SQL — and the test — an equality); an `in (...)` form only
// appears if the constant grows.
const revenueCond: SQL =
  REVENUE_READINESS.length === 1
    ? sql`${bookings.readiness} = ${REVENUE_READINESS[0]}`
    : sql`${bookings.readiness} in ${sql.join(
        REVENUE_READINESS.map((s) => sql`${s}`),
        sql`, `,
      )}`

// Inclusive range over `date_from`. Multi-day bookings are bucketed by their start
// day only (`date_to` is ignored in v1) — a booking lands whole in the bucket of
// its first day. `date_from` is a `date` (no time/TZ), so `date_trunc`/`to_char`
// below are timezone-free and deterministic.
function dateRange(fromIso: string, toIso: string): SQL {
  return and(gte(bookings.dateFrom, fromIso), lte(bookings.dateFrom, toIso))!
}

// Single bucketing key per granularity (see plan §"Бакетинг"). `week` truncates to
// the ISO week (Monday); `month` collapses to `YYYY-MM`; `day` is the ISO date.
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

// Period totals in one scan. `noClientCount` (records with no linked client) rides
// along here — it's a period-record count, not a client count, so it stays separate
// from the retention query and its new/returning clients.
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

// Revenue (only «Выдана») and volume (all statuses) per bucket. GROUP BY emits only
// buckets that have rows — the route zero-fills the gaps so the line chart doesn't
// smooth over empty periods.
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

// New vs returning, by first-ever booking. `first_seen` is each client's MIN(date_from)
// over VISITS (readiness NOT IN NON_VISIT_READINESS) across the whole table — a client is
// «new» when that first visit falls inside the period, «returning» when it predates the
// period. Both counts are over clients active (≥1 visit) in the period. NOTE: bounded by
// the mirror's horizon (Feb 2026) — "new" means "first in our DB", not truly first visit.
export function buildRetentionQuery(db: Db, p: RangeParams) {
  const firstSeen = db.$with('first_seen').as(
    db
      .select({
        clientId: bookings.clientId,
        firstFrom: sql<string>`min(${bookings.dateFrom})`.as('first_from'),
      })
      .from(bookings)
      .where(
        and(
          isNotNull(bookings.clientId),
          notInArray(bookings.readiness, [...NON_VISIT_READINESS]),
        ),
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

export interface TopParams extends RangeParams {
  order: 'sum' | 'visits'
}

// Top clients by delivered revenue or delivered visits. The «Выдана» filter lives in
// the WHERE, not in a per-metric FILTER — so a client with no delivered booking in the
// period is dropped from the grouping entirely (rather than surfacing as a sum=0/visits=0
// row and eating a LIMIT-10 slot when fewer than 10 clients delivered). A period with no
// deliveries yields an empty top. INNER JOIN on clients drops null-client records.
export function buildTopQuery(db: Db, p: TopParams) {
  const sumExpr = sql<string>`coalesce(sum(${bookings.amount}), 0)`
  const visitsExpr = sql<string>`count(*)`
  return db
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
    // Secondary key breaks ties deterministically — without it, equal sum/visits
    // leave the LIMIT 10 cutoff up to Postgres' arbitrary row order.
    .orderBy(p.order === 'sum' ? desc(sumExpr) : desc(visitsExpr), asc(bookings.clientId))
    .limit(10)
}

export interface AnalyticsParams extends SeriesParams {
  prevFromIso: string
  prevToIso: string
}

// Raw aggregates as postgres-js returns them — SUM/COUNT are STRINGS. The route
// coerces every field with Number() at the response boundary. @hono/zod-openapi
// does NOT runtime-validate responses, so an uncoerced string wouldn't error here
// — but the web client does arithmetic on these numbers (avgCheck, Δ%, repeatRate,
// chart math), and string operands would silently corrupt it (e.g. '1'+'2'='12').
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
  topByVisits: RawTopClient[]
}

export async function getAnalyticsOverview(p: AnalyticsParams): Promise<RawAnalytics> {
  const db = getDb()

  const [totalsRow] = await buildTotalsQuery(db, { fromIso: p.fromIso, toIso: p.toIso })
  const [prevRow] = await buildTotalsQuery(db, { fromIso: p.prevFromIso, toIso: p.prevToIso })
  const series = await buildSeriesQuery(db, p)
  const [retentionRow] = await buildRetentionQuery(db, { fromIso: p.fromIso, toIso: p.toIso })
  const topBySum = await buildTopQuery(db, { fromIso: p.fromIso, toIso: p.toIso, order: 'sum' })
  const topByVisits = await buildTopQuery(db, {
    fromIso: p.fromIso,
    toIso: p.toIso,
    order: 'visits',
  })

  return {
    // An aggregate with no matching rows still returns one row (with COALESCE'd 0s).
    totals: totalsRow ?? { total: '0', completedCount: '0', bookingsCount: '0', noClientCount: '0' },
    prevTotal: prevRow?.total ?? '0',
    series,
    retention: retentionRow ?? { newCount: '0', returningCount: '0' },
    topBySum,
    topByVisits,
  }
}
