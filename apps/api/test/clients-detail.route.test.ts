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
  getClientByPhone: vi.fn(),
  getClientStats: vi.fn(),
}))

vi.mock('../src/db/client-cars.js', () => ({
  listCarsByClientIds: vi.fn(),
  listCarsByClient: vi.fn(),
}))

// Частичный мок: в БД ходит только listBookingsByClientId, его и подменяем; чистый
// маппер toBookingRow остаётся настоящим, чтобы роут проверял реальный wire-маппинг
// (id-ссылки отбрасываются, сумма есть в карточке только для админа, живые имена проходят).
vi.mock('../src/db/bookings.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/db/bookings.js')>()
  return { ...actual, listBookingsByClientId: vi.fn() }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { getClientById, getClientByPhone, getClientStats } from '../src/db/clients.js'
import { listCarsByClient } from '../src/db/client-cars.js'
import { listBookingsByClientId } from '../src/db/bookings.js'
import { adminCookie, bookerCookie, employeeCookie } from './auth-helpers.js'

const CLIENT = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  phone: '+79001234567',
  name: 'Иван',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
}

const CAR = { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }

// Сохранённая строка записи (в форме schema.$inferSelect). В `master` уже лежит
// актуальное имя — withLiveMasterNames работает внутри замоканного
// listBookingsByClientId, так что роут просто пропускает его дальше.
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

  it('возвращает клиента (с машинами), статистику и историю с актуальными именами мастеров', async () => {
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
    // Актуальное имя мастера проходит без изменений.
    expect(row.master).toEqual(['Пётр (актуальное имя)'])
    // Карточка только для админа → сумма присутствует.
    expect(row.amount).toBe(5000)
    // Внутренние id-ссылки никогда не уходят в ответ.
    expect(row.idempotencyKey).toBeUndefined()
    expect(row.responsibleId).toBeUndefined()
    expect(row.carId).toBeUndefined()
    // История запрашивается с лимитом.
    expect(vi.mocked(listBookingsByClientId)).toHaveBeenCalledWith(CLIENT.id, 500)
  })

  it('пустая история даёт [] и не обрезана', async () => {
    vi.mocked(listBookingsByClientId).mockResolvedValue([])
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bookings).toEqual([])
    expect(body.bookingsTruncated).toBe(false)
  })

  it('помечает обрезку, если история превышает лимит', async () => {
    // Пришло cap+1 строк → truncated true, ответ обрезан до лимита.
    const many = Array.from({ length: 501 }, (_, i) => ({ ...BOOKING_ROW, id: `id-${i}` }))
    vi.mocked(listBookingsByClientId).mockResolvedValue(many)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bookings).toHaveLength(500)
    expect(body.bookingsTruncated).toBe(true)
  })

  it('неизвестный id → 404 not_found', async () => {
    vi.mocked(getClientById).mockResolvedValue(null)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'not_found' })
  })

  it('некорректный uuid → 400', async () => {
    const res = await app.request('/api/clients/not-a-uuid', { headers: { Cookie: cookie } })
    expect(res.status).toBe(400)
  })

  it('БД не готова → 503 unavailable', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await app.request(`/api/clients/${CLIENT.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
  })

  it('не админ → 403', async () => {
    const res = await app.request(`/api/clients/${CLIENT.id}`, {
      headers: { Cookie: await employeeCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('закрыт для booker, которому доступен только lookup', async () => {
    const res = await app.request(`/api/clients/${CLIENT.id}`, {
      headers: { Cookie: await bookerCookie() },
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/clients/lookup', () => {
  const app = createApp()
  const lookup = async (cookie: string, phone = CLIENT.phone) =>
    app.request(`/api/clients/lookup?phone=${encodeURIComponent(phone)}`, {
      headers: { Cookie: cookie },
    })

  beforeEach(() => {
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(getClientByPhone).mockResolvedValue(CLIENT)
    vi.mocked(listCarsByClient).mockResolvedValue([CAR])
    vi.mocked(getClientStats).mockResolvedValue(STATS)
    vi.mocked(listBookingsByClientId).mockResolvedValue([
      { ...BOOKING_ROW, readiness: 'Отмена', dateFrom: '2026-07-01', service: 'Химчистка' },
      BOOKING_ROW,
    ])
  })

  it('отдаёт booker клиента и сводку без денег', async () => {
    const res = await lookup(await bookerCookie())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(vi.mocked(getClientByPhone)).toHaveBeenCalledWith(CLIENT.phone)
    expect(body.match.client.cars).toEqual([CAR])
    expect(body.match.summary).toEqual({
      visitCount: 1,
      lastVisit: '2026-06-10',
      lastService: 'Мойка',
      missed: { cancelled: 1, noShow: 0, lastDate: '2026-07-01' },
    })
    expect(JSON.stringify(body)).not.toContain('5000')
  })

  it('добавляет totalSpent для админа', async () => {
    const res = await lookup(await adminCookie())
    const body = await res.json()
    expect(body.match.summary.totalSpent).toBe(5000)
  })

  it('возвращает null для неизвестного телефона', async () => {
    vi.mocked(getClientByPhone).mockResolvedValue(null)
    const res = await lookup(await bookerCookie())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, match: null })
  })

  it('отклоняет всё, кроме полного телефона, чтобы нельзя было перебирать клиентов', async () => {
    const res = await lookup(await bookerCookie(), '+7916')
    expect(res.status).toBe(400)
    expect(vi.mocked(getClientByPhone)).not.toHaveBeenCalledWith('+7916')
  })

  it('закрыт для employee', async () => {
    const res = await lookup(await employeeCookie())
    expect(res.status).toBe(403)
  })

  it('возвращает 503, если БД недоступна', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await lookup(await bookerCookie())
    expect(res.status).toBe(503)
  })
})

describe('остальные роуты клиентов для booker', () => {
  const app = createApp()

  it.each([
    ['GET', '/api/clients'],
    ['GET', '/api/clients/export'],
    ['POST', '/api/clients'],
    ['DELETE', `/api/clients/${CLIENT.id}`],
  ])('%s %s → 403', async (method, path) => {
    const res = await app.request(path, { method, headers: { Cookie: await bookerCookie() } })
    expect(res.status).toBe(403)
  })
})

describe('доступ к прайс-листу', () => {
  const app = createApp()

  it('пропускает booker через guard только на чтение', async () => {
    const cookie = await bookerCookie()
    const read = await app.request('/api/pricelist', { headers: { Cookie: cookie } })
    expect(read.status).not.toBe(403)
    const write = await app.request('/api/pricelist/sections', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(write.status).toBe(403)
  })

  it('не открывает чтение для employee', async () => {
    const res = await app.request('/api/pricelist', {
      headers: { Cookie: await employeeCookie() },
    })
    expect(res.status).toBe(403)
  })
})
