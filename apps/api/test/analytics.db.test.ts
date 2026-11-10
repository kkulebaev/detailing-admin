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

// НЕПОДКЛЮЧЁННЫЙ экземпляр drizzle: postgres() ленив (сокета нет, пока не выполнится
// запрос), а toSQL() лишь собирает текст, поэтому эти тесты проверяют ВЕСЬ генерируемый
// SQL — FILTER/GROUP BY/CTE/LIMIT — без Postgres. fakeDb НЕ используется: его
// .groupBy() — сквозная заглушка, которая не генерирует SQL.
const sql = postgres('postgres://placeholder@localhost:5432/placeholder', { max: 1 })
const db = drizzle(sql, { schema })

afterAll(async () => {
  await sql.end({ timeout: 1 })
})

const RANGE = { fromIso: '2026-07-01', toIso: '2026-07-31' }

describe('buildTotalsQuery (AC1, AC12)', () => {
  it('фильтрует выручку по = «Выдана» и ограничивает date_from включительно', () => {
    const { sql: text, params } = buildTotalsQuery(db, RANGE).toSQL()
    const low = text.toLowerCase()

    // Сумма выручки и число завершённых — обе под FILTER по позитивному равенству
    // «Выдана», без логики исключения через «not in (…)» для денег.
    expect(low).toContain('filter (where')
    expect(low).not.toContain('not in')
    expect(params).toContain('Выдана')

    // Включительный диапазон по date_from.
    expect(low).toContain('"date_from" >=')
    expect(low).toContain('"date_from" <=')
    expect(params).toContain('2026-07-01')
    expect(params).toContain('2026-07-31')

    // bookingsCount — голый count(*) (объём — все статусы).
    expect(low).toContain('count(*)')
  })
})

describe('buildSeriesQuery (AC2)', () => {
  it('группирует по ключу дня', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'day' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain('to_char("date_from"::date, \'yyyy-mm-dd\')')
  })

  it('группирует по date_trunc(week) при недельной гранулярности', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'week' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain('date_trunc(\'week\', "date_from"::date)')
  })

  it('группирует по корзине YYYY-MM при месячной гранулярности', () => {
    const { sql: text } = buildSeriesQuery(db, { ...RANGE, granularity: 'month' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('group by')
    expect(low).toContain('to_char("date_from"::date, \'yyyy-mm\')')
  })

  it('держит выручку серии под «Выдана», а объём считает без фильтра (AC12)', () => {
    const { sql: text, params } = buildSeriesQuery(db, { ...RANGE, granularity: 'day' }).toSQL()
    const low = text.toLowerCase()
    expect(low).toContain('filter (where')
    expect(params).toContain('Выдана')
    // count(*) без фильтра — объём корзины.
    expect(low).toContain('count(*)')
  })
})

describe('buildRetentionQuery (AC3)', () => {
  it('использует CTE first_seen с MIN(date_from) по визитам и делит на новых/вернувшихся по first_from', () => {
    const { sql: text, params } = buildRetentionQuery(db, RANGE).toSQL()
    const low = text.toLowerCase()

    // CTE с MIN(date_from) только по визитам (БЕЗ двух статусов неявки).
    expect(low).toContain('"first_seen"')
    expect(low).toContain('min("date_from")')
    expect(low).toContain('not in')
    expect(params).toContain('Отмена')
    expect(params).toContain('Не приехал')

    // новые = first_from >= from, вернувшиеся = first_from < from.
    expect(low).toContain('"first_from" >=')
    expect(low).toContain('"first_from" <')
  })
})

describe('buildTopQuery (AC4)', () => {
  it('джойнит clients, сортирует по убыванию, ограничивает 10, сужает группировку до «Выдана» в WHERE', () => {
    const { sql: text, params } = buildTopQuery(db, { ...RANGE }).toSQL()
    const low = text.toLowerCase()

    expect(low).toContain('"clients"')
    expect(low).toContain('order by')
    expect(low).toContain('desc')
    expect(low).toContain('limit')
    // Фильтр по выдаче стоит в WHERE (до GROUP BY), а не в FILTER на метрику — поэтому
    // клиенты без выданных записей выпадают из группировки, а не всплывают строками с sum=0.
    expect(low).not.toContain('filter (where')
    const whereClause = low.slice(low.indexOf('where'), low.indexOf('group by'))
    expect(whereClause).toContain('"readiness"')
    expect(params).toContain('Выдана')
    // limit равен 10.
    expect(params).toContain(10)
  })
})
