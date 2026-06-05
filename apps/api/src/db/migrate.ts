import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.js'

// Resolved relative to process.cwd(), which is the package root in both
// `pnpm dev` (apps/api/) and the production container (/app/, see Dockerfile).
// Override with MIGRATIONS_FOLDER if the deployment layout differs.
const DEFAULT_MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle')

export async function runMigrations(db: Db, folder?: string): Promise<void> {
  const migrationsFolder = folder ?? process.env.MIGRATIONS_FOLDER ?? DEFAULT_MIGRATIONS_FOLDER
  await migrate(db, { migrationsFolder })
}
