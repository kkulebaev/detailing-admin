import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { env } from '../env.js'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

let _sql: ReturnType<typeof postgres> | null = null
let _db: Db | null = null

export function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(env.DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      // Глушим идемпотентный NOTICE-шум мигратора drizzle
      // (например, «schema drizzle already exists, skipping»). Настоящие ошибки
      // по-прежнему приходят через промис запроса.
      onnotice: () => {},
    })
  }
  return _sql
}

export function getDb(): Db {
  if (!_db) {
    _db = drizzle(getSql(), { schema })
  }
  return _db
}

/** Только для тестов — подставляет mock db (или null для сброса). */
export function _setDbForTest(db: Db | null): void {
  _db = db
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 })
    _sql = null
    _db = null
  }
}
