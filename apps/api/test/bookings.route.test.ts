import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

vi.mock('../src/sheets.js', () => ({
  appendBooking: vi.fn(),
  verifyHeaders: vi.fn(),
  _setClientForTest: vi.fn(),
}))

vi.mock('../src/db/clients.js', () => ({
  upsertClient: vi.fn(),
}))

vi.mock('../src/db/client-cars.js', () => ({
  upsertClientCarReturningId: vi.fn(),
  selectCarId: vi.fn(),
}))

// Частичный мок: функции, обращающиеся к БД, заглушены, а чистый маппер toBookingRow
// остается настоящим — регрессионные проверки GET-списка (id-ссылки отброшены, сумма
// скрыта от не-админа) прогоняют вынесенный маппер через маршрут.
vi.mock('../src/db/bookings.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/db/bookings.js')>()
  return {
    ...actual,
    insertBooking: vi.fn(),
    listBookings: vi.fn(),
    updateBooking: vi.fn(),
    updateBookingReadiness: vi.fn(),
    deleteBooking: vi.fn(),
    restoreBooking: vi.fn(),
    listBookingHistory: vi.fn(),
    listDeletedBookings: vi.fn(),
  }
})

vi.mock('../src/notify.js', () => ({
  notifyMaster: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { _clearForTest, set as setIdempotency } from '../src/idempotency.js'
import { appendBooking } from '../src/sheets.js'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  isDbReady,
} from '../src/boot.js'
import { upsertClient } from '../src/db/clients.js'
import { selectCarId, upsertClientCarReturningId } from '../src/db/client-cars.js'
import type { Booking } from '../src/db/schema.js'
import {
  insertBooking,
  listBookings,
  updateBooking,
  updateBookingReadiness,
  deleteBooking,
  restoreBooking,
  listBookingHistory,
  listDeletedBookings,
} from '../src/db/bookings.js'
import { notifyMaster } from '../src/notify.js'
import { baseLogger } from '../src/log.js'
import { adminCookie, bookerCookie, employeeCookie } from './auth-helpers.js'

const VALID_PAYLOAD = {
  dateFrom: '04.06.2026',
  time: '10:00',
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  amount: 5000,
  master: ['Иван Содель'],
  responsible: 'Иван Содель',
  carClass: 3,
}

const APPEND_SUCCESS = {
  ok: true as const,
  updatedRange: 'Запись 2026!A5',
  updatedRow: 5,
  latencyMs: 12,
  statusCode: 200,
}

// Снимки из adminCookie()/bookerCookie(): имя в них пустое.
const ADMIN_ACTOR = { id: 'u-admin', login: 'admin', name: '' }
const BOOKER_ACTOR = { id: 'u-booker', login: 'booker', name: '' }

// Выставляется в beforeEach — каждый защищенный запрос идет с валидной cookie admin-сессии.
let authCookie = ''

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
): Response | Promise<Response> {
  return app.request('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie, ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bookings', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    app = createApp()
    _clearForTest()
    authCookie = await adminCookie()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
    vi.mocked(appendBooking).mockResolvedValue(APPEND_SUCCESS)
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'inserted', client: null })
    vi.mocked(upsertClientCarReturningId).mockResolvedValue('car-uuid-1')
    vi.mocked(insertBooking).mockResolvedValue(true)
    vi.mocked(notifyMaster).mockResolvedValue({ attempted: true, delivered: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('возвращает 201 с ok:true и X-Request-Id на валидный payload', async () => {
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.idempotent).toBe(false)
    expect(typeof body.updatedRange).toBe('string')
    expect(typeof body.updatedRow).toBe('number')
    expect(body.updatedRow).toBeGreaterThanOrEqual(2)
  })

  it('вызывает Sheets ровно один раз на первый запрос', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-once' })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('тот же Idempotency-Key в пределах TTL возвращает idempotent:true при единственном вызове Sheets', async () => {
    const key = 'idem-key'
    const r1 = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    const r2 = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })

    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1.idempotent).toBe(false)
    expect(b2.idempotent).toBe(true)
    expect(b2.updatedRange).toBe(b1.updatedRange)
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('разные Idempotency-Key дают два вызова Sheets', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-a' })
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-b' })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(2)
  })

  it('после истечения TTL тот же ключ снова идет в Sheets', async () => {
    vi.useFakeTimers()
    const key = 'ttl-key'

    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(2)
  })

  it('без Idempotency-Key возвращает 400 с ошибкой валидации', async () => {
    const res = await post(app, VALID_PAYLOAD)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('validation')
    expect(
      (body.issues as Array<{ path: unknown[] }>).some((i) => i.path.includes('Idempotency-Key')),
    ).toBe(true)
  })

  it('невалидное поле time возвращает 400 с ошибкой по пути ["time"]', async () => {
    const res = await post(
      app,
      { dateFrom: '04.06.2026', time: '25:99' },
      { 'Idempotency-Key': 'k' },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    const issue = (body.issues as Array<{ path: unknown[] }>).find((i) => i.path.includes('time'))
    expect(issue).toBeTruthy()
  })

  it('без dateFrom возвращает 400 с ошибкой валидации', async () => {
    const res = await post(app, { time: '10:00' }, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
  })

  it('при bootState === headers_mismatch возвращает 503 unavailable без вызова Sheets', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('headers_mismatch')
    expect(body.column_index).toBe(8)
    expect(body.expected).toBe('Готовность')
    expect(body.observed).toBe('Готовнсть')
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('503 из-за блокировки boot не пишет лог на каждый запрос (plan §7)', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })
    vi.mocked(baseLogger.info).mockClear()
    vi.mocked(baseLogger.warn).mockClear()
    vi.mocked(baseLogger.error).mockClear()

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    expect(vi.mocked(baseLogger.info)).not.toHaveBeenCalled()
    expect(vi.mocked(baseLogger.warn)).not.toHaveBeenCalled()
    expect(vi.mocked(baseLogger.error)).not.toHaveBeenCalled()
  })

  it('при bootState === not_configured возвращает 503 с reason:not_configured и сообщением', async () => {
    vi.mocked(getBootState).mockReturnValue('not_configured')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
    vi.mocked(getBootNotConfiguredMessage).mockReturnValue('Invalid base64 credentials')

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('not_configured')
    expect(body.message).toBe('Invalid base64 credentials')
    expect(body.column_index).toBeUndefined()
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('Idempotency-Key длиннее 128 символов возвращает 400 с ошибкой валидации', async () => {
    const longKey = 'k'.repeat(200)
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': longKey })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('validation')
    expect(
      (body.issues as Array<{ path: unknown[]; message: string }>).some(
        (i) => i.path.includes('Idempotency-Key') && /128/.test(i.message),
      ),
    ).toBe(true)
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('просочившаяся в кэш не-ok запись при попадании вытесняется, а не возвращается', async () => {
    const key = 'leaked-error-key'
    setIdempotency(key, {
      ok: false,
      error: 'internal',
    })
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Просочившаяся запись вытеснена, поэтому Sheets вызван заново.
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('сбой Sheets возвращает 502 с error:sheets', async () => {
    vi.mocked(appendBooking).mockResolvedValue({
      ok: false,
      latencyMs: 5,
      statusCode: 503,
      errorCode: 'rateLimitExceeded',
      message: 'Rate limit exceeded',
    })
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-fail' })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('sheets')
  })

  it('делает upsert клиента с нормализованными телефоном и именем после успешного append в Sheets', async () => {
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '8 (900) 123-45-67', name: 'Иван' },
      { 'Idempotency-Key': 'k-client' },
    )
    expect(vi.mocked(upsertClient)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsertClient)).toHaveBeenCalledWith('+79001234567', 'Иван')
  })

  it('не вызывает upsertClient, если БД не готова (best-effort)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-no-db' },
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(upsertClient)).not.toHaveBeenCalled()
  })

  it('не уведомляет мастера, если notify не передан', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-no-notify' })
    expect(vi.mocked(notifyMaster)).not.toHaveBeenCalled()
  })

  it('уведомляет мастера и возвращает результат доставки, когда notify равен true', async () => {
    const res = await post(
      app,
      { ...VALID_PAYLOAD, notify: true },
      { 'Idempotency-Key': 'k-notify-ok' },
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(notifyMaster)).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.notification).toEqual({ attempted: true, delivered: true })
  })

  it('запись все равно создается и сообщает о неудачном уведомлении (best-effort)', async () => {
    vi.mocked(notifyMaster).mockResolvedValue({
      attempted: true,
      delivered: false,
      reason: 'no_telegram_id',
    })
    const res = await post(
      app,
      { ...VALID_PAYLOAD, notify: true },
      { 'Idempotency-Key': 'k-notify-fail' },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.notification).toEqual({
      attempted: true,
      delivered: false,
      reason: 'no_telegram_id',
    })
  })

  it('идемпотентный повтор возвращает закэшированное уведомление без повторной отправки', async () => {
    const key = 'k-notify-replay'
    await post(app, { ...VALID_PAYLOAD, notify: true }, { 'Idempotency-Key': key })
    const res = await post(app, { ...VALID_PAYLOAD, notify: true }, { 'Idempotency-Key': key })
    const body = await res.json()
    expect(body.idempotent).toBe(true)
    expect(body.notification).toEqual({ attempted: true, delivered: true })
    // Повтор не должен отправлять заново — notifyMaster вызван только при первом запросе.
    expect(vi.mocked(notifyMaster)).toHaveBeenCalledTimes(1)
  })

  it('запись все равно создается, если upsertClient падает (best-effort)', async () => {
    vi.mocked(upsertClient).mockRejectedValueOnce(new Error('db connection refused'))
    const res = await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-db-fail' },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.client_upsert_failed' }),
      expect.any(String),
    )
  })

  it('зеркалирует запись в БД со ссылками на клиента и машину и координатами в Sheets', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'inserted',
      client: { id: 'client-uuid-1', phone: '+79001234567', name: 'Иван', createdAt: new Date() },
    })
    vi.mocked(upsertClientCarReturningId).mockResolvedValue('car-uuid-9')
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '8 (900) 123-45-67', name: 'Иван' },
      { 'Idempotency-Key': 'k-mirror' },
    )
    expect(vi.mocked(insertBooking)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+79001234567', name: 'Иван' }),
      {
        idempotencyKey: 'k-mirror',
        clientId: 'client-uuid-1',
        carId: 'car-uuid-9',
        sheetRow: 5,
        sheetRange: 'Запись 2026!A5',
        actor: ADMIN_ACTOR,
      },
    )
  })

  it('не зеркалирует запись, если БД не готова (best-effort)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-no-mirror' })
    expect(res.status).toBe(201)
    expect(vi.mocked(insertBooking)).not.toHaveBeenCalled()
  })

  it('зеркалирует запись с пустой ссылкой на клиента, если upsertClient падает', async () => {
    vi.mocked(upsertClient).mockRejectedValueOnce(new Error('db connection refused'))
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-mirror-null-client' },
    )
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        clientId: null,
        // Нет клиента → машина тоже не резолвится (Fork 5).
        carId: null,
        idempotencyKey: 'k-mirror-null-client',
      }),
    )
    expect(vi.mocked(upsertClientCarReturningId)).not.toHaveBeenCalled()
  })

  it('запись все равно создается, если insert в зеркало падает (best-effort)', async () => {
    vi.mocked(insertBooking).mockRejectedValueOnce(new Error('unique violation'))
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-mirror-fail' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.db_mirror_failed' }),
      expect.any(String),
    )
  })

  it('сохраняет машину клиента и проставляет car_id после успешной записи (best-effort)', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'inserted',
      client: { id: 'client-uuid-1', phone: '+79001234567', name: 'Иван', createdAt: new Date() },
    })
    vi.mocked(upsertClientCarReturningId).mockResolvedValue('car-uuid-9')
    await post(
      app,
      { ...VALID_PAYLOAD, car: 'Toyota Camry', plate: 'А123АА77' },
      { 'Idempotency-Key': 'k-car' },
    )
    expect(vi.mocked(upsertClientCarReturningId)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsertClientCarReturningId)).toHaveBeenCalledWith(
      'client-uuid-1',
      'Toyota Camry',
      'А123АА77',
    )
    // Найденный id машины передается в insert зеркала.
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ carId: 'car-uuid-9' }),
    )
  })

  it('не сохраняет машину, если БД не готова (best-effort)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-car-no-db' })
    expect(res.status).toBe(201)
    expect(vi.mocked(upsertClientCarReturningId)).not.toHaveBeenCalled()
  })

  it('не сохраняет машину, если клиент не привязан (clientId равен null)', async () => {
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'skipped', client: null })
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-car-no-client' })
    expect(res.status).toBe(201)
    expect(vi.mocked(upsertClientCarReturningId)).not.toHaveBeenCalled()
  })

  it('сбой сохранения машины не отменяет insert в зеркало и проставляет car_id=null', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'inserted',
      client: { id: 'client-uuid-1', phone: '+79001234567', name: 'Иван', createdAt: new Date() },
    })
    vi.mocked(upsertClientCarReturningId).mockRejectedValueOnce(new Error('unique violation'))
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-car-fail' })
    expect(res.status).toBe(201)
    expect((await res.json()).ok).toBe(true)
    // Insert в зеркало должен выполниться несмотря на сбой с машиной, с пустой ссылкой.
    expect(vi.mocked(insertBooking)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ carId: null }),
    )
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.client_car_upsert_failed' }),
      expect.any(String),
    )
  })

  it('позволяет booker отправить форму записи', async () => {
    const res = await post(app, VALID_PAYLOAD, {
      'Idempotency-Key': 'k-booker-write',
      Cookie: await bookerCookie(),
    })
    expect(res.status).toBe(201)
    expect(vi.mocked(appendBooking)).toHaveBeenCalled()
  })

  it('отклоняет создание записи от роли без доступа к записям', async () => {
    const res = await post(app, VALID_PAYLOAD, {
      'Idempotency-Key': 'k-emp-write',
      Cookie: await employeeCookie(),
    })
    expect(res.status).toBe(403)
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })
})

describe('GET /api/bookings', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  const SAMPLE_ROW: Booking = {
    id: '11111111-1111-1111-1111-111111111111',
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 5000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: '',
    master: ['Иван Содель'],
    responsible: 'Иван Содель',
    responsibleId: 7,
    carId: 'car-uuid-1',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listBookings).mockResolvedValue({ items: [SAMPLE_ROW], total: 1 })
  })

  function getList(query = '', headers: Record<string, string> = { Cookie: cookie }) {
    return app.request(`/api/bookings${query}`, { method: 'GET', headers })
  }

  it('возвращает 200 с items и total для admin, без ключа идемпотентности', async () => {
    const res = await getList()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(SAMPLE_ROW.id)
    expect(body.items[0].createdAt).toBe('2026-06-01T12:00:00.000Z')
    expect(body.items[0].idempotencyKey).toBeUndefined()
    // Производные id-ссылки — внутренние и никогда не должны уходить в ответ (AC9).
    expect(body.items[0].responsibleId).toBeUndefined()
    expect(body.items[0].responsible_id).toBeUndefined()
    expect(body.items[0].carId).toBeUndefined()
    expect(body.items[0].car_id).toBeUndefined()
    // Проверка на уровне байтов: производный id не должен утечь ни под каким написанием ключа.
    expect(JSON.stringify(body.items[0])).not.toContain('car-uuid-1')
    // Админы видят сумму.
    expect(body.items[0].amount).toBe(SAMPLE_ROW.amount)
  })

  it('конвертирует фильтры дат DD.MM.YYYY в ISO и пробрасывает пагинацию/поиск', async () => {
    const qs = new URLSearchParams({
      dateFrom: '04.06.2026',
      dateTo: '05.06.2026',
      master: 'Иван Содель',
      q: 'Toyota',
      limit: '10',
      offset: '20',
    })
    await getList(`?${qs.toString()}`)
    expect(vi.mocked(listBookings)).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
      dateFrom: '2026-06-04',
      dateTo: '2026-06-05',
      master: 'Иван Содель',
      readiness: undefined,
      q: 'Toyota',
      sort: 'desc',
    })
  })

  it('пробрасывает сортировку по возрастанию', async () => {
    await getList('?sort=asc')
    expect(vi.mocked(listBookings)).toHaveBeenCalledWith(expect.objectContaining({ sort: 'asc' }))
  })

  it('отклоняет неизвестную сортировку → 400', async () => {
    const res = await getList('?sort=sideways')
    expect(res.status).toBe(400)
    expect(vi.mocked(listBookings)).not.toHaveBeenCalled()
  })

  it('возвращает 503, если БД не готова, не выполняя запросов', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await getList()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(vi.mocked(listBookings)).not.toHaveBeenCalled()
  })

  it('возвращает 401 без auth-cookie', async () => {
    const res = await getList('', {})
    expect(res.status).toBe(401)
  })

  it('позволяет роли не-админа читать список, но вырезает поля с суммами', async () => {
    const res = await getList('', { Cookie: await employeeCookie() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    // Поля, не связанные с суммами, остаются видимыми…
    expect(body.items[0].name).toBe(SAMPLE_ROW.name)
    // …а суммы — только для админа.
    expect(body.items[0].amount).toBeUndefined()
    expect(body.items[0].amountFormula).toBeUndefined()
  })

  it('показывает суммы booker', async () => {
    const res = await getList('', { Cookie: await bookerCookie() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].amount).toBe(SAMPLE_ROW.amount)
  })

  it('возвращает 400 при некорректном фильтре по дате', async () => {
    const res = await getList('?dateFrom=2026-06-04')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
  })
})

describe('GET /api/bookings/export', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  const SAMPLE_ROW: Booking = {
    id: '11111111-1111-1111-1111-111111111111',
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 5000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: '',
    master: ['Иван Содель'],
    responsible: 'Иван Содель',
    responsibleId: 7,
    carId: 'car-uuid-1',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listBookings).mockResolvedValue({ items: [SAMPLE_ROW], total: 1 })
  })

  const getExport = (query = '', headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/export${query}`, { method: 'GET', headers })

  it('возвращает 200 text/csv с BOM и Content-Disposition для admin', async () => {
    const res = await getExport()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"/,
    )
    // Читаем сырые байты: res.text() декодирует UTF-8 и срезает ведущий BOM, поэтому
    // BOM нужно проверять по байтам ответа (EF BB BF).
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder('utf-8').decode(buf)
    // Админ видит колонку с деньгами; телефон обезврежен от инъекций ('+7…).
    expect(text).toContain('Сумма')
    expect(text).toContain('Иван')
    expect(text).toContain("'+79991234567")
  })

  it('не выводит колонку Сумма для роли не-админа', async () => {
    const res = await getExport('', { Cookie: await employeeCookie() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('Сумма')
    expect(text).toContain('Иван')
  })

  it('выводит колонку Сумма для booker', async () => {
    const res = await getExport('', { Cookie: await bookerCookie() })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Сумма')
  })

  it('пробрасывает фильтры в listBookings с лимитом экспорта и без пагинации', async () => {
    const qs = new URLSearchParams({
      dateFrom: '04.06.2026',
      dateTo: '05.06.2026',
      master: 'Иван Содель',
      readiness: 'В работе',
      q: 'Toyota',
      sort: 'asc',
    })
    await getExport(`?${qs.toString()}`)
    expect(vi.mocked(listBookings)).toHaveBeenCalledWith({
      limit: 10000,
      offset: 0,
      dateFrom: '2026-06-04',
      dateTo: '2026-06-05',
      master: 'Иван Содель',
      readiness: 'В работе',
      q: 'Toyota',
      sort: 'asc',
    })
  })

  it('возвращает 503, если БД не готова, не выполняя запросов', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await getExport()
    expect(res.status).toBe(503)
    expect(vi.mocked(listBookings)).not.toHaveBeenCalled()
  })

  it('возвращает 400 при некорректном фильтре по дате', async () => {
    const res = await getExport('?dateFrom=2026-06-04')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation')
    expect(vi.mocked(listBookings)).not.toHaveBeenCalled()
  })

  it('возвращает 401 без auth-cookie', async () => {
    const res = await getExport('', {})
    expect(res.status).toBe(401)
  })
})

describe('PATCH & DELETE /api/bookings/{id}', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''
  const ID = '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e'
  const UPDATED_ROW: Booking = {
    id: ID,
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 7000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: 'Готова к выдаче',
    master: ['Иван Содель'],
    responsible: 'Иван Содель',
    responsibleId: 7,
    carId: 'car-uuid-1',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'updated', client: null })
    vi.mocked(selectCarId).mockResolvedValue('car-uuid-1')
    vi.mocked(updateBooking).mockResolvedValue(UPDATED_ROW)
    vi.mocked(updateBookingReadiness).mockResolvedValue(UPDATED_ROW)
    vi.mocked(deleteBooking).mockResolvedValue(true)
  })

  const patch = (body: unknown, headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const del = (headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}`, { method: 'DELETE', headers })

  it('PATCH обновляет запись для admin → 200 с обновленной строкой (без ключа идемпотентности)', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'updated',
      client: { id: 'client-uuid-1', phone: '+79991234567', name: 'Иван', createdAt: new Date() },
    })
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.booking.id).toBe(ID)
    expect(body.booking.amount).toBe(7000)
    expect(body.booking.idempotencyKey).toBeUndefined()
    // Производные id-ссылки — внутренние и никогда не должны уходить в ответ (AC9).
    expect(body.booking.responsibleId).toBeUndefined()
    expect(body.booking.responsible_id).toBeUndefined()
    expect(body.booking.carId).toBeUndefined()
    expect(body.booking.car_id).toBeUndefined()
    expect(JSON.stringify(body.booking)).not.toContain('car-uuid-1')
    expect(vi.mocked(updateBooking)).toHaveBeenCalled()
    // Ссылка на машину резолвится только чтением (selectCarId, а не upsert) и передается
    // в updateBooking, чтобы PATCH никогда не накапливал строки client_cars.
    expect(vi.mocked(selectCarId)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(updateBooking)).toHaveBeenCalledWith(
      ID,
      expect.any(Object),
      'client-uuid-1',
      'car-uuid-1',
      ADMIN_ACTOR,
    )
  })

  it('PATCH все равно возвращает 200 с пустой ссылкой на машину, если selectCarId падает (best-effort)', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'updated',
      client: { id: 'client-uuid-1', phone: '+79991234567', name: 'Иван', createdAt: new Date() },
    })
    vi.mocked(selectCarId).mockRejectedValueOnce(new Error('db blip'))
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(200)
    expect(vi.mocked(updateBooking)).toHaveBeenCalledWith(
      ID,
      expect.any(Object),
      'client-uuid-1',
      null,
      ADMIN_ACTOR,
    )
  })

  it('PATCH не резолвит ссылку на машину, если клиент равен null (selectCarId не вызывается)', async () => {
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'skipped', client: null })
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(200)
    expect(vi.mocked(selectCarId)).not.toHaveBeenCalled()
    expect(vi.mocked(updateBooking)).toHaveBeenCalledWith(
      ID,
      expect.any(Object),
      null,
      null,
      ADMIN_ACTOR,
    )
  })

  it('PATCH несуществующей записи → 404', async () => {
    vi.mocked(updateBooking).mockResolvedValue(null)
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('PATCH с невалидным телом → 400', async () => {
    const res = await patch({ ...VALID_PAYLOAD, time: '99:99' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation')
  })

  it('PATCH от booker → 200', async () => {
    const res = await patch(VALID_PAYLOAD, { Cookie: await bookerCookie() })
    expect(res.status).toBe(200)
    expect(vi.mocked(updateBooking)).toHaveBeenCalled()
  })

  it('PATCH от employee → 403', async () => {
    const res = await patch(VALID_PAYLOAD, { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(updateBooking)).not.toHaveBeenCalled()
  })

  it('PATCH возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await patch(VALID_PAYLOAD)).status).toBe(503)
  })

  it('DELETE удаляет запись для admin → 200', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(vi.mocked(deleteBooking)).toHaveBeenCalledWith(ID, ADMIN_ACTOR)
  })

  it('DELETE несуществующей записи → 404', async () => {
    vi.mocked(deleteBooking).mockResolvedValue(false)
    expect((await del()).status).toBe(404)
  })

  it('DELETE от booker → 200', async () => {
    const res = await del({ Cookie: await bookerCookie() })
    expect(res.status).toBe(200)
    expect(vi.mocked(deleteBooking)).toHaveBeenCalledWith(ID, BOOKER_ACTOR)
  })

  it('DELETE от employee → 403', async () => {
    const res = await del({ Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(deleteBooking)).not.toHaveBeenCalled()
  })

  it('DELETE возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await del()).status).toBe(503)
  })

  const patchReadiness = (body: unknown, headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}/readiness`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('PATCH readiness обновляет только статус для admin → 200', async () => {
    const res = await patchReadiness({ readiness: 'В работе' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.booking.id).toBe(ID)
    // Производные id-ссылки никогда не уходят в ответ (AC9).
    expect(body.booking.responsibleId).toBeUndefined()
    expect(body.booking.carId).toBeUndefined()
    expect(body.booking.car_id).toBeUndefined()
    expect(JSON.stringify(body.booking)).not.toContain('car-uuid-1')
    expect(vi.mocked(updateBookingReadiness)).toHaveBeenCalledWith(ID, 'В работе', ADMIN_ACTOR)
  })

  it('PATCH readiness принимает пустое значение (сброшенный статус) → 200', async () => {
    const res = await patchReadiness({ readiness: '' })
    expect(res.status).toBe(200)
    expect(vi.mocked(updateBookingReadiness)).toHaveBeenCalledWith(ID, '', ADMIN_ACTOR)
  })

  it('PATCH readiness отклоняет невалидное значение → 400', async () => {
    const res = await patchReadiness({ readiness: 'НеСуществует' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation')
    expect(vi.mocked(updateBookingReadiness)).not.toHaveBeenCalled()
  })

  it('PATCH readiness несуществующей записи → 404', async () => {
    vi.mocked(updateBookingReadiness).mockResolvedValue(null)
    expect((await patchReadiness({ readiness: 'Готова к выдаче' })).status).toBe(404)
  })

  it('PATCH readiness от booker → 200', async () => {
    const res = await patchReadiness({ readiness: 'В работе' }, { Cookie: await bookerCookie() })
    expect(res.status).toBe(200)
    expect(vi.mocked(updateBookingReadiness)).toHaveBeenCalledWith(ID, 'В работе', BOOKER_ACTOR)
  })

  it('PATCH readiness от employee → 403', async () => {
    const res = await patchReadiness({ readiness: 'В работе' }, { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(updateBookingReadiness)).not.toHaveBeenCalled()
  })

  it('PATCH readiness возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await patchReadiness({ readiness: 'В работе' })).status).toBe(503)
  })
})

describe('журнал и корзина записей', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''
  const ID = '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e'
  const ROW: Booking = {
    id: ID,
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 7000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: 'Выдана',
    master: ['Иван Содель'],
    responsible: 'Иван Содель',
    responsibleId: 7,
    carId: 'car-uuid-1',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  const get = (path: string, headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(path, { headers })
  const restore = (headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}/restore`, { method: 'POST', headers })

  it('GET history отдает записи журнала без снимка', async () => {
    vi.mocked(listBookingHistory).mockResolvedValue([
      {
        id: 1,
        entity: 'booking',
        entityId: ID,
        action: 'update',
        actorId: 'u-admin',
        actorLogin: 'admin',
        actorName: 'Анна',
        changes: [{ field: 'amount', from: 5000, to: 7000 }],
        snapshot: null,
        at: new Date('2026-06-02T10:00:00.000Z'),
      },
      {
        id: 2,
        entity: 'booking',
        entityId: ID,
        action: 'delete',
        actorId: 'u-admin',
        actorLogin: 'admin',
        actorName: 'Анна',
        changes: null,
        snapshot: { booking: { ...ROW, createdAt: ROW.createdAt.toISOString() }, masters: [] },
        at: new Date('2026-06-03T10:00:00.000Z'),
      },
    ])
    const res = await get(`/api/bookings/${ID}/history`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([
      {
        id: 1,
        action: 'update',
        actorLogin: 'admin',
        actorName: 'Анна',
        at: '2026-06-02T10:00:00.000Z',
        changes: [{ field: 'amount', from: 5000, to: 7000 }],
      },
      {
        id: 2,
        action: 'delete',
        actorLogin: 'admin',
        actorName: 'Анна',
        at: '2026-06-03T10:00:00.000Z',
        changes: null,
      },
    ])
  })

  it('GET deleted отдает корзину с суммами и автором удаления', async () => {
    vi.mocked(listDeletedBookings).mockResolvedValue([
      { booking: ROW, deletedAt: new Date('2026-06-03T10:00:00.000Z'), deletedBy: 'Анна' },
    ])
    const res = await get('/api/bookings/deleted')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      deletedAt: '2026-06-03T10:00:00.000Z',
      deletedBy: 'Анна',
      booking: { id: ID, amount: 7000 },
    })
    expect(body.items[0].booking.idempotencyKey).toBeUndefined()
  })

  it('POST restore возвращает восстановленную запись', async () => {
    vi.mocked(restoreBooking).mockResolvedValue({ ok: true, booking: ROW })
    const res = await restore()
    expect(res.status).toBe(200)
    expect((await res.json()).booking.id).toBe(ID)
    expect(vi.mocked(restoreBooking)).toHaveBeenCalledWith(ID, ADMIN_ACTOR)
  })

  it('POST restore без снимка → 404, повторный → 409', async () => {
    vi.mocked(restoreBooking).mockResolvedValueOnce({ ok: false, reason: 'not_found' })
    expect((await restore()).status).toBe(404)
    vi.mocked(restoreBooking).mockResolvedValueOnce({ ok: false, reason: 'already_restored' })
    const res = await restore()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, error: 'conflict', reason: 'already_restored' })
  })

  it.each([
    ['booker', bookerCookie],
    ['employee', employeeCookie],
  ])('закрыто для %s → 403', async (_role, makeCookie) => {
    const headers = { Cookie: await makeCookie() }
    expect((await get(`/api/bookings/${ID}/history`, headers)).status).toBe(403)
    expect((await get('/api/bookings/deleted', headers)).status).toBe(403)
    expect((await restore(headers)).status).toBe(403)
    expect(vi.mocked(listBookingHistory)).not.toHaveBeenCalled()
    expect(vi.mocked(listDeletedBookings)).not.toHaveBeenCalled()
    expect(vi.mocked(restoreBooking)).not.toHaveBeenCalled()
  })

  it('возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await get(`/api/bookings/${ID}/history`)).status).toBe(503)
    expect((await get('/api/bookings/deleted')).status).toBe(503)
    expect((await restore()).status).toBe(503)
  })
})

describe('GET /healthz', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
  })

  it('возвращает 200 ok:true, когда boot в порядке', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.time).toBe('string')
  })

  it('возвращает 503 unavailable, когда bootState равен headers_mismatch', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })
    const res = await app.request('/healthz')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('headers_mismatch')
    expect(body.column_index).toBe(8)
  })
})

describe('фолбэк 404', () => {
  it('возвращает 404 для неизвестных маршрутов', async () => {
    const app = createApp()
    const res = await app.request('/unknown-path')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('not_found')
  })
})
