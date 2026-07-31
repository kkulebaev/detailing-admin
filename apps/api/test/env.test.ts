import { describe, it, expect } from 'vitest'
import { parseEnv } from '../src/env.js'

const BASE = {
  SPREADSHEET_ID: 'sheet123',
  SHEET_NAME: 'Запись 2026',
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
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
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    })
    expect(result.PORT).toBe(3000)
    expect(result.SHEET_NAME).toBe('Запись 2026')
    expect(result.WEB_ORIGIN).toBe('http://localhost:5173')
    expect(result.LOG_LEVEL).toBe('info')
  })

  it('applies auth cookie/ttl defaults', () => {
    const result = parseEnv(BASE)
    expect(result.AUTH_COOKIE_SECURE).toBe(false)
    expect(result.AUTH_COOKIE_SAMESITE).toBe('lax')
    expect(result.AUTH_TOKEN_TTL_SECONDS).toBe(86400)
    expect(result.AUTH_REMEMBER_TTL_SECONDS).toBe(2592000)
  })

  it('does not coerce the literal "false" to true for AUTH_COOKIE_SECURE', () => {
    expect(parseEnv({ ...BASE, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE).toBe(false)
    expect(parseEnv({ ...BASE, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE).toBe(true)
  })

  it('throws when AUTH_COOKIE_SAMESITE=none but AUTH_COOKIE_SECURE is not true', () => {
    // Browsers drop SameSite=None cookies without Secure — reject the combo at boot.
    expect(() => parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none' })).toThrow(
      'Environment validation failed',
    )
    expect(() =>
      parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow('Environment validation failed')
  })

  it('accepts AUTH_COOKIE_SAMESITE=none when AUTH_COOKIE_SECURE=true', () => {
    const result = parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'true' })
    expect(result.AUTH_COOKIE_SAMESITE).toBe('none')
    expect(result.AUTH_COOKIE_SECURE).toBe(true)
  })

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('throws when JWT_SECRET is shorter than 32 chars', () => {
    expect(() => parseEnv({ ...BASE, JWT_SECRET: 'short' })).toThrow('Environment validation failed')
  })

  it('redacts JWT_SECRET in error messages', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, JWT_SECRET: 'short' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('JWT_SECRET: [REDACTED]')
  })

  it('throws when SPREADSHEET_ID is missing', () => {
    expect(() =>
      parseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==' }),
    ).toThrow('Environment validation failed')
  })

  it('throws when GOOGLE_SERVICE_ACCOUNT_JSON_B64 is missing', () => {
    expect(() => parseEnv({ SPREADSHEET_ID: 'sheet123' })).toThrow()
  })

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('redacts DATABASE_URL in error messages', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, DATABASE_URL: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('DATABASE_URL: [REDACTED]')
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

  it('throws when TELEGRAM_BOT_TOKEN is missing', () => {
    const { TELEGRAM_BOT_TOKEN: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('redacts TELEGRAM_BOT_TOKEN in error messages', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, TELEGRAM_BOT_TOKEN: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('TELEGRAM_BOT_TOKEN: [REDACTED]')
  })

  it('does not throw for valid LOG_LEVEL values', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const) {
      expect(() => parseEnv({ ...BASE, LOG_LEVEL: level })).not.toThrow()
    }
  })
})
