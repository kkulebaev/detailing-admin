import { describe, it, expect, vi, beforeEach } from 'vitest'

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
}))

vi.mock('../src/db/client-cars.js', () => ({
  listCarsByClientIds: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { listClients, createClient, updateClient } from '../src/db/clients.js'
import { listCarsByClientIds } from '../src/db/client-cars.js'
import { adminCookie } from './auth-helpers.js'

const CLIENT_A = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  phone: '+79001234567',
  name: 'Иван',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
}
const CLIENT_B = {
  id: 'bbbbbbbb-2222-2222-2222-222222222222',
  phone: '+79007654321',
  name: 'Пётр',
  createdAt: new Date('2026-06-02T12:00:00.000Z'),
}

describe('GET /api/clients', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listClients).mockResolvedValue({ items: [CLIENT_A, CLIENT_B], total: 2 })
    vi.mocked(listCarsByClientIds).mockResolvedValue(
      new Map([[CLIENT_A.id, [{ id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }]]]),
    )
  })

  it('embeds cars per client; a client with no cars gets []', async () => {
    const res = await app.request('/api/clients', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const a = body.clients.find((c: { id: string }) => c.id === CLIENT_A.id)
    const b = body.clients.find((c: { id: string }) => c.id === CLIENT_B.id)
    expect(a.cars).toEqual([{ id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }])
    expect(b.cars).toEqual([])
    // Grouped fetch keyed by the page's client ids (no N+1).
    expect(vi.mocked(listCarsByClientIds)).toHaveBeenCalledWith([CLIENT_A.id, CLIENT_B.id])
  })
})

describe('clients mutations echo the reconciled cars', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  const CAR = { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('forwards cars to createClient and returns the actual set', async () => {
    vi.mocked(createClient).mockResolvedValue({ client: CLIENT_A, cars: [CAR] })
    const res = await app.request('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        phone: '+79001234567',
        name: 'Иван',
        cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.client.cars).toEqual([CAR])
    expect(vi.mocked(createClient)).toHaveBeenCalledWith('+79001234567', 'Иван', [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
  })

  it('forwards cars to updateClient and returns the actual set', async () => {
    vi.mocked(updateClient).mockResolvedValue({ client: CLIENT_A, cars: [CAR] })
    const res = await app.request(`/api/clients/${CLIENT_A.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        phone: '+79001234567',
        name: 'Иван',
        cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.client.cars).toEqual([CAR])
    expect(vi.mocked(updateClient)).toHaveBeenCalledWith(CLIENT_A.id, '+79001234567', 'Иван', [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
  })

  it('defaults cars to [] when the body omits them', async () => {
    vi.mocked(createClient).mockResolvedValue({ client: CLIENT_A, cars: [] })
    const res = await app.request('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ phone: '+79001234567', name: 'Иван' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.client.cars).toEqual([])
    expect(vi.mocked(createClient)).toHaveBeenCalledWith('+79001234567', 'Иван', [])
  })
})
