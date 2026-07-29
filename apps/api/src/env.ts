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
  // HS256 signing key for auth JWTs. Required (fail-closed): an empty/short
  // secret would let anyone forge a session, so boot must abort rather than
  // start an app that trusts unsigned tokens.
  JWT_SECRET: z.string().min(32),
  // Cookie hardening — driven by deploy topology (see auth plan §3-bis).
  // Local dev is http + same-origin, so both default to the permissive setting.
  // Explicit string→boolean map: z.coerce.boolean() treats the literal "false"
  // as truthy, which would silently force Secure cookies in local http dev.
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
}).superRefine((v, ctx) => {
  // SameSite=None cookies are dropped by browsers unless Secure — a
  // none+insecure combination would silently kill every session.
  if (v.AUTH_COOKIE_SAMESITE === 'none' && !v.AUTH_COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_COOKIE_SECURE'],
      message: 'must be true when AUTH_COOKIE_SAMESITE=none',
    })
  }
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
        path === 'TELEGRAM_BOT_TOKEN' ||
        path === 'JWT_SECRET'
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
