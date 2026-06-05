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
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  _resetForTest,
} from '../src/boot.js'
import { verifyHeaders } from '../src/sheets.js'
import { baseLogger } from '../src/log.js'

describe('boot.init', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
  })

  it('sets bootState to ok and emits boot.headers.ok when headers match', async () => {
    vi.mocked(verifyHeaders).mockResolvedValue({ ok: true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await init()

    expect(getBootState()).toBe('ok')
    expect(getBootHeadersMismatch()).toBeNull()

    // Exactly one info log emitted with the right event
    expect(vi.mocked(baseLogger.info)).toHaveBeenCalledTimes(1)
    const [logObj] = vi.mocked(baseLogger.info).mock.calls[0] as [Record<string, unknown>]
    expect(logObj.event).toBe('boot.headers.ok')

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

    // Exactly one error log emitted — not per-request, only at startup
    expect(vi.mocked(baseLogger.error)).toHaveBeenCalledTimes(1)
    const [logObj] = vi.mocked(baseLogger.error).mock.calls[0] as [Record<string, unknown>]
    expect(logObj.event).toBe('boot.headers.mismatch')
    expect(logObj.column_index).toBe(8)
    expect(logObj.expected).toBe('Готовность')
    expect(logObj.observed).toBe('Готовнсть')

    // process.exit must NOT be called
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('sets bootState to not_configured, captures the error message, and does NOT call process.exit on verifyHeaders throw', async () => {
    vi.mocked(verifyHeaders).mockRejectedValue(new Error('Network error'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await init()

    expect(getBootState()).toBe('not_configured')
    // HTTP-visible message is a safe summary — raw GCP/network detail must not
    // be exposed on the wire (it can leak credential/field-shape hints).
    expect(getBootNotConfiguredMessage()).toBe('Service credentials not configured or invalid')

    // Error log keeps the raw detail (redacted by pino's redact paths) — single startup signal.
    expect(vi.mocked(baseLogger.error)).toHaveBeenCalledTimes(1)
    const [logObj] = vi.mocked(baseLogger.error).mock.calls[0] as [Record<string, unknown>]
    expect(logObj.event).toBe('boot.init.error')
    expect(logObj.message).toBe('Network error')

    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})
