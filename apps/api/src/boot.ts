import { verifyHeaders } from './sheets.js'
import { baseLogger } from './log.js'
import { env } from './env.js'
import { getDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'

export type BootState = 'ok' | 'headers_mismatch' | 'not_configured'

let _bootState: BootState = 'ok'
let _bootHeadersMismatch: { column_index: number; expected: string; observed: string } | null = null
let _bootNotConfiguredMessage: string | null = null
let _dbReady = false

export function getBootState(): BootState {
  return _bootState
}

export function getBootHeadersMismatch(): {
  column_index: number
  expected: string
  observed: string
} | null {
  return _bootHeadersMismatch
}

export function getBootNotConfiguredMessage(): string | null {
  return _bootNotConfiguredMessage
}

/** Показывает, успешно ли прошли миграции БД при старте. Best-effort: маршрут
 * записи продолжает работать с Sheets, даже когда здесь false. */
export function isDbReady(): boolean {
  return _dbReady
}

/** Только для тестов — сбрасывает boot-состояние уровня модуля. */
export function _resetForTest(): void {
  _bootState = 'ok'
  _bootHeadersMismatch = null
  _bootNotConfiguredMessage = null
  _dbReady = false
}

/** Только для тестов — переопределяет флаг готовности БД, минуя миграции. */
export function _setDbReadyForTest(value: boolean): void {
  _dbReady = value
}

export async function initDb(): Promise<void> {
  try {
    const db = getDb()
    await runMigrations(db)
    _dbReady = true
    baseLogger.info({ event: 'boot.db.ready' }, 'DB migrations applied')
  } catch (err) {
    _dbReady = false
    const detail = err instanceof Error ? err.message : String(err)
    baseLogger.error(
      { event: 'boot.db.error', message: detail },
      'DB initialization failed — client upserts will be skipped',
    )
  }
}

export async function init(): Promise<void> {
  await initDb()
  try {
    const result = await verifyHeaders()
    if (result.ok) {
      _bootState = 'ok'
      baseLogger.info(
        {
          event: 'boot.headers.ok',
          spreadsheet_id: env.SPREADSHEET_ID,
          sheet_name: env.SHEET_NAME,
        },
        'Header verification passed',
      )
    } else {
      _bootState = 'headers_mismatch'
      _bootHeadersMismatch = {
        column_index: result.column_index,
        expected: result.expected,
        observed: result.observed,
      }
      baseLogger.error(
        {
          event: 'boot.headers.mismatch',
          column_index: result.column_index,
          expected: result.expected,
          observed: result.observed,
        },
        'Header verification failed — API will return 503 until restart',
      )
    }
  } catch (err) {
    // Учетных данных нет, они невалидны или сбой сети — НЕ выходим; listener поднимаем все равно.
    _bootState = 'not_configured'
    // Сырые подробности ошибки остаются в логе (с редактированием pino) и не уходят в ответ.
    // В HTTP-тело попадает безопасное общее описание, чтобы не утекли фрагменты ошибок GCP
    // (там могут упоминаться поля private_key, структура JWT, внутренний конфиг).
    const detail = err instanceof Error ? err.message : String(err)
    _bootNotConfiguredMessage = 'Service credentials not configured or invalid'
    baseLogger.error(
      {
        event: 'boot.init.error',
        message: detail,
      },
      'Boot init failed — API will return 503 until restart',
    )
  }
}
