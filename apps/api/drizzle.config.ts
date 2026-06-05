import { defineConfig } from 'drizzle-kit'

// DATABASE_URL is required for push/migrate/studio but unused by `generate`.
// Pass a dummy URL when generating; drizzle-kit will surface a clear connection
// error for commands that actually need credentials.
const url = process.env.DATABASE_URL ?? 'postgres://unset:unset@localhost:5432/unset'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})

