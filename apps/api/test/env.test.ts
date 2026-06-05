import { describe, it, expect } from 'vitest'
import { parseEnv } from '../src/env.js'

const BASE = {
  SPREADSHEET_ID: 'sheet123',
  SHEET_NAME: 'Запись 2026',
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==',
  WEB_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'info',
  PORT: '3000',
} as const

describe('parseEnv', () => {
  it('parses a valid env set', () => {
    const result = parseEnv(BASE)
    expect(result.SPREADSHEET_ID).toBe('sheet123')
    expect(result.PORT).toBe(3000)
    expect(result.LOG_LEVEL).toBe('info')
    expect(result.WEB_ORIGIN).toBe('http://localhost:5173')
  })

  it('applies defaults for PORT, SHEET_NAME, WEB_ORIGIN, LOG_LEVEL', () => {
    const result = parseEnv({
      SPREADSHEET_ID: 'sheet123',
      GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==',
    })
    expect(result.PORT).toBe(3000)
    expect(result.SHEET_NAME).toBe('Запись 2026')
    expect(result.WEB_ORIGIN).toBe('http://localhost:5173')
    expect(result.LOG_LEVEL).toBe('info')
  })

  it('throws when SPREADSHEET_ID is missing', () => {
    expect(() =>
      parseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==' }),
    ).toThrow('Environment validation failed')
  })

  it('throws when GOOGLE_SERVICE_ACCOUNT_JSON_B64 is missing', () => {
    expect(() => parseEnv({ SPREADSHEET_ID: 'sheet123' })).toThrow()
  })

  it('redacts GOOGLE_SERVICE_ACCOUNT_JSON_B64 in error messages', () => {
    // Provide SPREADSHEET_ID but set b64 to empty → zod reports an issue on that path,
    // which the redaction branch converts to [REDACTED] instead of the raw value.
    let errorMessage = ''
    try {
      parseEnv({ SPREADSHEET_ID: 'sheet123', GOOGLE_SERVICE_ACCOUNT_JSON_B64: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).not.toBe('')
    expect(errorMessage).toContain('[REDACTED]')
    // The raw (empty) value must not appear verbatim — and no other secret should leak
    expect(errorMessage).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON_B64: (?!.*\[REDACTED\])/)
  })

  it('does not throw for valid LOG_LEVEL values', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const) {
      expect(() => parseEnv({ ...BASE, LOG_LEVEL: level })).not.toThrow()
    }
  })
})
