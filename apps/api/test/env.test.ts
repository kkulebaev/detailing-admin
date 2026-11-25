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
  it('разбирает корректный набор env', () => {
    const result = parseEnv(BASE)
    expect(result.SPREADSHEET_ID).toBe('sheet123')
    expect(result.PORT).toBe(3000)
    expect(result.LOG_LEVEL).toBe('info')
    expect(result.WEB_ORIGIN).toBe('http://localhost:5173')
  })

  it('подставляет значения по умолчанию для PORT, SHEET_NAME, WEB_ORIGIN, LOG_LEVEL', () => {
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

  it('подставляет значения по умолчанию для auth cookie/ttl', () => {
    const result = parseEnv(BASE)
    expect(result.AUTH_COOKIE_SECURE).toBe(false)
    expect(result.AUTH_COOKIE_SAMESITE).toBe('lax')
    expect(result.AUTH_TOKEN_TTL_SECONDS).toBe(86400)
    expect(result.AUTH_REMEMBER_TTL_SECONDS).toBe(2592000)
  })

  it('не приводит литерал "false" к true для AUTH_COOKIE_SECURE', () => {
    expect(parseEnv({ ...BASE, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE).toBe(false)
    expect(parseEnv({ ...BASE, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE).toBe(true)
  })

  it('бросает, если AUTH_COOKIE_SAMESITE=none, а AUTH_COOKIE_SECURE не true', () => {
    // Браузеры отбрасывают cookie с SameSite=None без Secure — отклоняем такое сочетание при старте.
    expect(() => parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none' })).toThrow(
      'Environment validation failed',
    )
    expect(() =>
      parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow('Environment validation failed')
  })

  it('принимает AUTH_COOKIE_SAMESITE=none при AUTH_COOKIE_SECURE=true', () => {
    const result = parseEnv({ ...BASE, AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'true' })
    expect(result.AUTH_COOKIE_SAMESITE).toBe('none')
    expect(result.AUTH_COOKIE_SECURE).toBe(true)
  })

  it('бросает, если JWT_SECRET отсутствует', () => {
    const { JWT_SECRET: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('бросает, если JWT_SECRET короче 32 символов', () => {
    expect(() => parseEnv({ ...BASE, JWT_SECRET: 'short' })).toThrow(
      'Environment validation failed',
    )
  })

  it('скрывает JWT_SECRET в сообщениях об ошибках', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, JWT_SECRET: 'short' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('JWT_SECRET: [REDACTED]')
  })

  it('бросает, если SPREADSHEET_ID отсутствует', () => {
    expect(() => parseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'dGVzdA==' })).toThrow(
      'Environment validation failed',
    )
  })

  it('бросает, если GOOGLE_SERVICE_ACCOUNT_JSON_B64 отсутствует', () => {
    expect(() => parseEnv({ SPREADSHEET_ID: 'sheet123' })).toThrow()
  })

  it('бросает, если DATABASE_URL отсутствует', () => {
    const { DATABASE_URL: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('скрывает DATABASE_URL в сообщениях об ошибках', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, DATABASE_URL: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('DATABASE_URL: [REDACTED]')
  })

  it('скрывает GOOGLE_SERVICE_ACCOUNT_JSON_B64 в сообщениях об ошибках', () => {
    // SPREADSHEET_ID задан, а b64 пустой → zod сообщает об ошибке по этому пути,
    // и ветка редактирования подставляет [REDACTED] вместо сырого значения.
    let errorMessage = ''
    try {
      parseEnv({ SPREADSHEET_ID: 'sheet123', GOOGLE_SERVICE_ACCOUNT_JSON_B64: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).not.toBe('')
    expect(errorMessage).toContain('[REDACTED]')
    // Сырое (пустое) значение не должно попасть в текст как есть — и другие секреты тоже не должны утечь
    expect(errorMessage).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON_B64: (?!.*\[REDACTED\])/)
  })

  it('бросает, если TELEGRAM_BOT_TOKEN отсутствует', () => {
    const { TELEGRAM_BOT_TOKEN: _omit, ...rest } = BASE
    expect(() => parseEnv(rest)).toThrow('Environment validation failed')
  })

  it('скрывает TELEGRAM_BOT_TOKEN в сообщениях об ошибках', () => {
    let errorMessage = ''
    try {
      parseEnv({ ...BASE, TELEGRAM_BOT_TOKEN: '' })
    } catch (err) {
      errorMessage = String(err)
    }
    expect(errorMessage).toContain('TELEGRAM_BOT_TOKEN: [REDACTED]')
  })

  it('не бросает для допустимых значений LOG_LEVEL', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const) {
      expect(() => parseEnv({ ...BASE, LOG_LEVEL: level })).not.toThrow()
    }
  })
})

describe('parseEnv — VAPID', () => {
  const VAPID = {
    VAPID_PUBLIC_KEY: 'BPublicKey',
    VAPID_PRIVATE_KEY: 'super-secret-private-key',
    VAPID_SUBJECT: 'mailto:owner@example.com',
  }

  it('без VAPID стартует, push выключен (критерий 9)', () => {
    const result = parseEnv(BASE)
    expect(result.VAPID_PUBLIC_KEY).toBeUndefined()
    expect(result.VAPID_PRIVATE_KEY).toBeUndefined()
    expect(result.VAPID_SUBJECT).toBeUndefined()
  })

  it('пустые строки из .env.example значат «не задано»', () => {
    const result = parseEnv({
      ...BASE,
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: ' ',
      VAPID_SUBJECT: '',
    })
    expect(result.VAPID_PUBLIC_KEY).toBeUndefined()
    expect(result.VAPID_PRIVATE_KEY).toBeUndefined()
  })

  it('принимает полный набор', () => {
    expect(parseEnv({ ...BASE, ...VAPID }).VAPID_SUBJECT).toBe('mailto:owner@example.com')
  })

  it('половина ключей — ошибка, приватный ключ не попадает в сообщение', () => {
    let message = ''
    try {
      parseEnv({ ...BASE, VAPID_PRIVATE_KEY: VAPID.VAPID_PRIVATE_KEY })
    } catch (err) {
      message = String(err)
    }
    expect(message).toContain('VAPID_PRIVATE_KEY: [REDACTED]')
    expect(message).not.toContain(VAPID.VAPID_PRIVATE_KEY)
  })

  it('VAPID_SUBJECT только mailto: или https:', () => {
    expect(() => parseEnv({ ...BASE, ...VAPID, VAPID_SUBJECT: 'owner@example.com' })).toThrow(
      /VAPID_SUBJECT/,
    )
    expect(
      parseEnv({ ...BASE, ...VAPID, VAPID_SUBJECT: 'https://example.com' }).VAPID_SUBJECT,
    ).toBe('https://example.com')
  })
})
