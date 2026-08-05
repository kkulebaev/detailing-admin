import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
  },
}))

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../src/db/schema.js'
import {
  buildRetentionQuery,
  buildSeriesQuery,
  buildTopQuery,
  buildTotalsQuery,
} from '../src/db/analytics.js'

// An UNCONNECTED drizzle instance: postgres() is lazy (no socket until a query
// runs) and toSQL() only assembles text, so these tests validate the FULL emitted
// SQL — FILTER/GROUP BY/CTE/LIMIT — with no Postgres. fakeDb is NOT used: its
// .groupBy() is a passthrough stub that emits no SQL.
const sql = postgres('postgres://placeholder@localhost:5432/placeholder', { max: 1 })
const db = drizzle(sql, { schema })

afterAll(async () => {
  await sql.end({ timeout: 1 })
})

const RANGE = { fromIso: '2026-07-01', toIso: '2026-07-31' }

describe('buildTotalsQuery (AC1, AC12)', () => {
  it('filters revenue by = «Выдана» and bounds date_from inclusively', () => {
    const { sql: text, params } = buildTotalsQuery(db, RANGE).toSQL()
    const low = text.toLowerCase()

    // Revenue sum + completed count are both under a FILTER on the positive
    // «Выдана» equality — no "not in (…)" cancellation logic for money.
    expect(low).toContain('filter (where')
    expect(low).not.toContain('not in')
    expect(params).toContain('Выдана')

    // Inclusive range on date_from.
    expect(low).toContain('"date_from" >=')
    expect(low).toContain('"date_from" <=')
    expect(params).toContain('2026-07-01')
    expect(params).toContain('2026-07-31')

    // bookingsCount is a bare count(*) (volume — all statuses).
    expect(low).toContain('count(*)')
  })
})

describe('buildSeriesQuery (AC2)', () => {
  it('groups by the day bucket key', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'day' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain("to_char(\"date_from\"::date, 'yyyy-mm-dd')")
  })

  it('groups by date_trunc(week) for weekly granularity', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'week' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain("date_trunc('week', \"date_from\"::date)")
  })

  it('groups by the YYYY-MM bucket for monthly granularity', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'month' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain("to_char(\"date_from\"::date, 'yyyy-mm')")
  })

  it('keeps series revenue under «Выдана» but counts volume without a filter (AC12)', () => {
    const { sql: text, params } = buildSeriesQuery(db, { ...RANGE, granularity: 'day' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('filter (where')
    expect(params).toContain('Выдана')
    // count(*) with no filter — the bucket's volume.
    expect(low).toContain('count(*)')
  })
})

describe('buildRetentionQuery (AC3)', () => {
  it('uses a first_seen CTE of MIN(date_from) over visits and splits new/returning by first_from', () => {
    const { sql: text, params } = buildRetentionQuery(db, RANGE).toSQL()
    const low = text.toLowerCase()

    // CTE with MIN(date_from) restricted to visits (NOT the two no-show statuses).
    expect(low).toContain('"first_seen"')
    expect(low).toContain('min("date_from")')
    expect(low).toContain('not in')
    expect(params).toContain('Отмена')
    expect(params).toContain('Не приехал')

    // new = first_from >= from, returning = first_from < from.
    expect(low).toContain('"first_from" >=')
    expect(low).toContain('"first_from" <')
  })
})

describe('buildTopQuery (AC4)', () => {
  it('joins clients, ranks desc, limits 10, restricts the grouping to «Выдана» in WHERE', () => {
    const { sql: text, params } = buildTopQuery(db, { ...RANGE, order: 'sum' }).toSQL()
    const low = text.toLowerCase()

    expect(low).toContain('"clients"')
    expect(low).toContain('order by')
    expect(low).toContain('desc')
    expect(low).toContain('limit')
    // Delivery filter is in WHERE (before GROUP BY), not a per-metric FILTER — so
    // zero-delivered clients drop out of the grouping instead of surfacing as sum=0 rows.
    expect(low).not.toContain('filter (where')
    const whereClause = low.slice(low.indexOf('where'), low.indexOf('group by'))
    expect(whereClause).toContain('"readiness"')
    expect(params).toContain('Выдана')
    // limit is 10.
    expect(params).toContain(10)
  })

  it('orders by the plain visit count when order = visits', () => {
    const { sql: text } = buildTopQuery(db, { ...RANGE, order: 'visits' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('order by')
    expect(low).toContain('count(*)')
    expect(low).not.toContain('count(*) filter (where')
  })
})
