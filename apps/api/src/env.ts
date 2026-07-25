import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  SPREADSHEET_ID: z.string().min(1),
  SHEET_NAME: z.string().min(1).default('Запись 2026'),
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  // Bot token for master booking notifications. Required — a missing token
  // trips env validation at boot (same class as SPREADSHEET_ID).
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(raw: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.join('.')
      // Never expose raw secret values in error output
      if (
        path === 'GOOGLE_SERVICE_ACCOUNT_JSON_B64' ||
        path === 'DATABASE_URL' ||
        path === 'TELEGRAM_BOT_TOKEN'
      ) {
        return `  ${path}: [REDACTED] — ${issue.message}`
      }
      return `  ${path}: ${issue.message}`
    })
    throw new Error(`Environment validation failed:\n${lines.join('\n')}`)
  }
  return result.data
}

export const env = parseEnv()
