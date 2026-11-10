import { defineConfig } from 'drizzle-kit'

// DATABASE_URL нужен для push/migrate/studio, но не используется в `generate`.
// При генерации передавайте фиктивный URL; для команд, которым реально нужны
// учётные данные, drizzle-kit выдаст понятную ошибку подключения.
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
