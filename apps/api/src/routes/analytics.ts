import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  analyticsOverviewOkSchema,
  ddmmyyyyToIso,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  validationErrorSchema,
  type AnalyticsGranularity,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { getAnalyticsOverview, type RawTopClient } from '../db/analytics.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

type Vars = { requestId: string }

const overviewQuerySchema = z.object({
  // UI sends DD.MM.YYYY; converted to ISO before the DB layer. Bad shapes 400.
  from: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
  to: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
})

const overviewRoute = createRoute({
  method: 'get',
  path: '/overview',
  tags: ['analytics'],
  request: { query: overviewQuerySchema },
  responses: {
    200: {
      description: 'Analytics overview (revenue + clients)',
      content: { 'application/json': { schema: analyticsOverviewOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: internalErrorSchema } },
    },
    503: {
      description: 'Database unavailable',
      content: { 'application/json': { schema: dbUnavailableErrorSchema } },
    },
  },
})

/** Milliseconds in a day — for the previous-period shift below. */
const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Previous period of the same length, immediately before [from,to]:
 * prevTo = from − 1 day, prevFrom = from − (to − from + 1 day). */
function previousPeriod(fromIso: string, toIso: string): { prevFromIso: string; prevToIso: string } {
  const from = new Date(`${fromIso}T00:00:00Z`)
  const to = new Date(`${toIso}T00:00:00Z`)
  const lengthDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1
  const prevTo = new Date(from.getTime() - DAY_MS)
  const prevFrom = new Date(from.getTime() - lengthDays * DAY_MS)
  return { prevFromIso: isoDate(prevFrom), prevToIso: isoDate(prevTo) }
}

/** Every bucket key from `from` to `to` inclusive, matching the SQL bucketing, so
 * the series can be zero-filled — GROUP BY only returns buckets with rows, and a
 * line chart would otherwise smooth over the gaps (visual lie). */
function enumerateBuckets(fromIso: string, toIso: string, g: AnalyticsGranularity): string[] {
  const buckets: string[] = []
  const start = new Date(`${fromIso}T00:00:00Z`)
  const end = new Date(`${toIso}T00:00:00Z`)

  if (g === 'month') {
    let y = start.getUTCFullYear()
    let m = start.getUTCMonth()
    const ey = end.getUTCFullYear()
    const em = end.getUTCMonth()
    while (y < ey || (y === ey && m <= em)) {
      buckets.push(`${y}-${String(m + 1).padStart(2, '0')}`)
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }
    return buckets
  }

  if (g === 'week') {
    // Monday of the ISO week containing `start` — matches date_trunc('week', …).
    const cur = new Date(start)
    const mondayOffset = (cur.getUTCDay() + 6) % 7
    cur.setUTCDate(cur.getUTCDate() - mondayOffset)
    while (cur.getTime() <= end.getTime()) {
      buckets.push(isoDate(cur))
      cur.setUTCDate(cur.getUTCDate() + 7)
    }
    return buckets
  }

  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    buckets.push(isoDate(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return buckets
}

function mapTop(t: RawTopClient) {
  return {
    // Non-null assertion: the INNER JOIN on clients guarantees a linked client id
    // (the column is nullable, but a null could never satisfy the join).
    clientId: t.clientId!,
    name: t.name,
    phone: t.phone,
    sum: Number(t.sum),
    visits: Number(t.visits),
  }
}

const router = new OpenAPIHono<{ Variables: Vars }>()

router.openapi(
  overviewRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) {
      return c.json(
        {
          ok: false as const,
          error: 'unavailable' as const,
          reason: 'not_configured' as const,
          message: 'Database not configured or migrations failed',
        },
        StatusCodes.SERVICE_UNAVAILABLE,
      )
    }

    const query = c.req.valid('query')
    const fromIso = ddmmyyyyToIso(query.from)
    const toIso = ddmmyyyyToIso(query.to)
    const { prevFromIso, prevToIso } = previousPeriod(fromIso, toIso)

    try {
      const raw = await getAnalyticsOverview({
        fromIso,
        toIso,
        prevFromIso,
        prevToIso,
        granularity: query.granularity,
      })

      // postgres-js returns SUM/COUNT as strings — coerce every aggregate here.
      const total = Number(raw.totals.total)
      const completedCount = Number(raw.totals.completedCount)
      const bookingsCount = Number(raw.totals.bookingsCount)
      const noClientCount = Number(raw.totals.noClientCount)
      const prevTotal = Number(raw.prevTotal)
      const newCount = Number(raw.retention.newCount)
      const returningCount = Number(raw.retention.returningCount)

      // Derived metrics, all guarded against a zero denominator.
      const avgCheck = completedCount === 0 ? 0 : Math.round(total / completedCount)
      const revenuePct =
        prevTotal === 0 ? null : Math.round(((total - prevTotal) / prevTotal) * 1000) / 10
      const attributable = newCount + returningCount
      const repeatRate =
        attributable === 0 ? null : Math.round((returningCount / attributable) * 1000) / 10

      // Zero-fill: left-join the enumerated buckets to the aggregate result.
      const byBucket = new Map(raw.series.map((s) => [s.bucket, s]))
      const series = enumerateBuckets(fromIso, toIso, query.granularity).map((bucket) => {
        const hit = byBucket.get(bucket)
        return {
          bucket,
          revenue: hit ? Number(hit.revenue) : 0,
          count: hit ? Number(hit.count) : 0,
        }
      })

      baseLogger.info(
        {
          event: 'analytics.overview',
          request_id: requestId,
          from: fromIso,
          to: toIso,
          granularity: query.granularity,
          status: 200,
        },
        'Analytics overview served',
      )

      return c.json(
        {
          ok: true as const,
          period: { from: query.from, to: query.to, granularity: query.granularity },
          revenue: {
            total,
            avgCheck,
            completedCount,
            bookingsCount,
            delta: { revenuePct, prevTotal },
            series,
          },
          clients: {
            newCount,
            returningCount,
            noClientCount,
            repeatRate,
            topBySum: raw.topBySum.map(mapTop),
          },
        },
        StatusCodes.OK,
      )
    } catch (err) {
      baseLogger.error(
        {
          event: 'analytics.overview.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Analytics overview failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  },
  defaultValidationHook,
)

export default router
