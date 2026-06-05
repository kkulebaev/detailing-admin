import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EXPECTED_HEADERS } from '@detailing-admin/shared/sheet-row'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-spreadsheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../src/sheets.js', () => ({
  verifyHeaders: vi.fn(),
  appendBooking: vi.fn(),
  _setClientForTest: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({
  getDb: vi.fn().mockReturnValue({}),
  getSql: vi.fn(),
  closeDb: vi.fn(),
  _setDbForTest: vi.fn(),
}))

vi.mock('../src/db/migrate.js', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../src/log.js', () => ({
  baseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

import {
  init,
  initDb,
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  isDbReady,
  _resetForTest,
} from '../src/boot.js'
import { verifyHeaders } from '../src/sheets.js'
import { runMigrations } from '../src/db/migrate.js'
import { baseLogger } from '../src/log.js'

function eventsOf(spy: ReturnType<typeof vi.fn>): string[] {
  return (spy.mock.calls as Array<[Record<string, unknown>, unknown?]>).map(
    ([obj]) => obj.event as string,
  )
}

describe('boot.init', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
    // DB init succeeds by default — sheets behavior is what each test varies.
    vi.mocked(runMigrations).mockResolvedValue(undefined)
  })

  it('sets bootState to ok and emits boot.headers.ok when headers match', async () => {
    vi.mocked(verifyHeaders).mockResolvedValue({ ok: true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await init()

    expect(getBootState()).toBe('ok')
    expect(getBootHeadersMismatch()).toBeNull()
    expect(eventsOf(vi.mocked(baseLogger.info))).toContain('boot.headers.ok')

    // process.exit must NOT be called
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('sets bootState to headers_mismatch and emits boot.headers.mismatch on header diff', async () => {
    vi.mocked(verifyHeaders).mockResolvedValue({
      ok: false,
      column_index: 8,
      expected: EXPECTED_HEADERS[8] as string,
      observed: 'Готовнсть',
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await init()

    expect(getBootState()).toBe('headers_mismatch')
    const mismatch = getBootHeadersMismatch()
    expect(mismatch).not.toBeNull()
    expect(mismatch?.column_index).toBe(8)
    expect(mismatch?.expected).toBe('Готовность')
    expect(mismatch?.observed).toBe('Готовнсть')

    // The mismatch event is emitted exactly once — not per-request, only at startup.
    const errorEvents = eventsOf(vi.mocked(baseLogger.error))
    expect(errorEvents.filter((e) => e === 'boot.headers.mismatch')).toHaveLength(1)
    const mismatchCall = vi
      .mocked(baseLogger.error)
      .mock.calls.find(([obj]) => (obj as Record<string, unknown>).event === 'boot.headers.mismatch')
    expect(mismatchCall).toBeTruthy()
    const [logObj] = mismatchCall as [Record<string, unknown>, unknown]
    expect(logObj.column_index).toBe(8)
    expect(logObj.expected).toBe('Готовность')
    expect(logObj.observed).toBe('Готовнсть')

    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('sets bootState to not_configured, captures the error message, and does NOT call process.exit on verifyHeaders throw', async () => {
    vi.mocked(verifyHeaders).mockRejectedValue(new Error('Network error'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await init()

    expect(getBootState()).toBe('not_configured')
    expect(getBootNotConfiguredMessage()).toBe('Service credentials not configured or invalid')

    const initErrorCall = vi
      .mocked(baseLogger.error)
      .mock.calls.find(([obj]) => (obj as Record<string, unknown>).event === 'boot.init.error')
    expect(initErrorCall).toBeTruthy()
    const [logObj] = initErrorCall as [Record<string, unknown>, unknown]
    expect(logObj.message).toBe('Network error')

    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})

describe('boot.initDb', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
  })

  it('marks DB ready and logs boot.db.ready on successful migration', async () => {
    vi.mocked(runMigrations).mockResolvedValue(undefined)
    await initDb()
    expect(isDbReady()).toBe(true)
    expect(eventsOf(vi.mocked(baseLogger.info))).toContain('boot.db.ready')
  })

  it('keeps DB not ready and logs boot.db.error when migration throws', async () => {
    vi.mocked(runMigrations).mockRejectedValue(new Error('ECONNREFUSED'))
    await initDb()
    expect(isDbReady()).toBe(false)
    const errorCall = vi
      .mocked(baseLogger.error)
      .mock.calls.find(([obj]) => (obj as Record<string, unknown>).event === 'boot.db.error')
    expect(errorCall).toBeTruthy()
    const [logObj] = errorCall as [Record<string, unknown>, unknown]
    expect(logObj.message).toBe('ECONNREFUSED')
  })
})
