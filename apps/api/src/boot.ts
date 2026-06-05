import { verifyHeaders } from './sheets.js'
import { baseLogger } from './log.js'
import { env } from './env.js'
import { getDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'

export type BootState = 'ok' | 'headers_mismatch' | 'not_configured'

let _bootState: BootState = 'ok'
let _bootHeadersMismatch: { column_index: number; expected: string; observed: string } | null =
  null
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

/** Indicates whether DB migrations ran successfully on boot. Best-effort; the
 * booking route stays operational against Sheets even when this is false. */
export function isDbReady(): boolean {
  return _dbReady
}

/** For tests only — resets module-level boot state. */
export function _resetForTest(): void {
  _bootState = 'ok'
  _bootHeadersMismatch = null
  _bootNotConfiguredMessage = null
  _dbReady = false
}

/** For tests only — overrides the db-ready flag without going through migrations. */
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
    // Credentials missing/invalid or network error — do NOT exit; bind listener anyway.
    _bootState = 'not_configured'
    // Raw error detail stays in the log (redacted by pino), never on the wire.
    // The HTTP body gets a safe, generic summary so GCP error fragments (which can
    // mention private_key fields, JWT structure, internal config) do not leak.
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
