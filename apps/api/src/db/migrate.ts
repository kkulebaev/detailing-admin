import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.js'

// Путь считается от process.cwd(), а это корень пакета и в `pnpm dev` (apps/api/),
// и в production-контейнере (/app/, см. Dockerfile).
// Если раскладка деплоя другая, переопредели через MIGRATIONS_FOLDER.
const DEFAULT_MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle')

export async function runMigrations(db: Db, folder?: string): Promise<void> {
  const migrationsFolder = folder ?? process.env.MIGRATIONS_FOLDER ?? DEFAULT_MIGRATIONS_FOLDER
  await migrate(db, { migrationsFolder })
}
