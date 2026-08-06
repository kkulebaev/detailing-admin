import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Booking } from '../src/db/schema.js'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    AUTH_COOKIE_SECURE: false,
    AUTH_COOKIE_SAMESITE: 'lax',
    AUTH_TOKEN_TTL_SECONDS: 86400,
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../src/log.js', () => ({
  baseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

vi.mock('../src/boot.js', () => ({
  getBootState: vi.fn().mockReturnValue('ok'),
  getBootHeadersMismatch: vi.fn().mockReturnValue(null),
  getBootNotConfiguredMessage: vi.fn().mockReturnValue(null),
  isDbReady: vi.fn().mockReturnValue(true),
  init: vi.fn(),
  initDb: vi.fn(),
}))

vi.mock('../src/db/clients.js', () => ({
  ClientError: class ClientError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'ClientError'
    }
  },
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  getClientById: vi.fn(),
  getClientStats: vi.fn(),
}))

vi.mock('../src/db/client-cars.js', () => ({
  listCarsByClientIds: vi.fn(),
  listCarsByClient: vi.fn(),
}))

// Partial mock: only listBookingsByClientId hits the DB and is stubbed; the pure
// toBookingRow mapper stays real so the route exercises the true wire mapping
// (id-links dropped, amount included for the admin-only card, live names flow).
vi.mock('../src/db/bookings.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/db/bookings.js')>()
  return { ...actual, listBookingsByClientId: vi.fn() }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { getClientById, getClientStats } from '../src/db/clients.js'
import { listCarsByClient } from '../src/db/client-cars.js'
import { listBookingsByClientId } from '../src/db/bookings.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const CLIENT = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  phone: '+79001234567',
  name: 'Иван',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
}

const CAR = { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }

// A stored booking row (schema.$inferSelect shape). `master` already carries the
// live-overlaid name — withLiveMasterNames runs inside the mocked
// listBookingsByClientId, so the route just maps it through.
const BOOKING_ROW: Booking = {
  id: 'dddddddd-4444-4444-4444-444444444444',
  idempotencyKey: 'key-1',
  clientId: CLIENT.id,
  name: 'Иван',
  phone: '+79001234567',
  car: 'Toyota Camry А123АА77',
  service: 'Мойка',
  note: '',
  amount: 5000,
  amountFormula: null,
  dateFrom: '2026-06-10',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: 'Выдана',
  master: ['Пётр (актуальное имя)'],
  responsible: 'Пётр',
  responsibleId: 7,
  carId: 'car-uuid-1',
  carClass: 2,
  sheetRow: 42,
  sheetRange: "'Запись 2026'!A42",
  createdAt: new Date('2026-06-09T08:00:00.000Z'),
}

const STATS = {
  totalSpent: 5000,
  visitCount: 1,
  lastVisit: '2026-06-10',
  firstVisit: '2026-06-10',
}

describe('GET /api/clients/{id}', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(getClientById).mockResolvedValue(CLIENT)
    vi.mocked(listCarsByClient).mockResolvedValue([CAR])
    vi.mocked(getClientStats).mockResolvedValue(STATS)
    vi.mocked(listBookingsByClientId).mockResolvedValue([BOOKING_ROW])
  })

  it('returns the client (with cars), stats, and history with live master names', async () => {
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.client.id).toBe(CLIENT.id)
    expect(body.client.cars).toEqual([CAR])
    expect(body.stats).toEqual(STATS)
    expect(body.bookingsTruncated).toBe(false)
    expect(body.bookings).toHaveLength(1)
    const row = body.bookings[0]
    // Live-overlaid master name flows through untouched.
    expect(row.master).toEqual(['Пётр (актуальное имя)'])
    // Card is admin-only → amount present.
    expect(row.amount).toBe(5000)
    // Internal id-links never leak onto the wire.
    expect(row.idempotencyKey).toBeUndefined()
    expect(row.responsibleId).toBeUndefined()
    expect(row.carId).toBeUndefined()
    // History fetched with the cap.
    expect(vi.mocked(listBookingsByClientId)).toHaveBeenCalledWith(CLIENT.id, 500)
  })

  it('empty history yields [] and not truncated', async () => {
    vi.mocked(listBookingsByClientId).mockResolvedValue([])
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bookings).toEqual([])
    expect(body.bookingsTruncated).toBe(false)
  })

  it('flags truncation when the history exceeds the cap', async () => {
    // cap+1 rows come back → truncated true, response sliced to the cap.
    const many = Array.from({ length: 501 }, (_, i) => ({ ...BOOKING_ROW, id: `id-${i}` }))
    vi.mocked(listBookingsByClientId).mockResolvedValue(many)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bookings).toHaveLength(500)
    expect(body.bookingsTruncated).toBe(true)
  })

  it('unknown id → 404 not_found', async () => {
    vi.mocked(getClientById).mockResolvedValue(null)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'not_found' })
  })

  it('malformed uuid → 400', async () => {
    const res = await app.request('/api/clients/not-a-uuid', { headers: { Cookie: cookie } })
    expect(res.status).toBe(400)
  })

  it('DB not ready → 503 unavailable', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
  })

  it('non-admin → 403', async () => {
    const res = await app.request(`/api/clients/${CLIENT.id}`, {
      headers: { Cookie: await employeeCookie() },
    })
    expect(res.status).toBe(403)
  })
})
