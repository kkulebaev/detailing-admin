import { z } from 'zod'

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    SPREADSHEET_ID: z.string().min(1),
    SHEET_NAME: z.string().min(1).default('Запись 2026'),
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    // Токен бота для уведомлений мастеров о записях. Обязателен — без токена
    // валидация env падает при старте (так же, как с SPREADSHEET_ID).
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    // Ключ подписи HS256 для JWT авторизации. Обязателен (fail-closed): с пустым или
    // коротким секретом кто угодно подделает сессию, поэтому старт должен прерваться,
    // а не запустить приложение, доверяющее неподписанным токенам.
    JWT_SECRET: z.string().min(32),
    // Усиление cookie — зависит от топологии деплоя (см. план авторизации, §3-bis).
    // Локальная разработка — http + same-origin, поэтому оба по умолчанию мягкие.
    // Явное отображение string→boolean: z.coerce.boolean() считает литерал "false"
    // истинным, что молча включило бы Secure cookie в локальной http-разработке.
    AUTH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    AUTH_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
    AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    // Время жизни сессии «Запомнить меня» (по умолчанию 30 дней). Выбирается при входе,
    // если отмечена галочка; определяет и exp у JWT, и maxAge у cookie.
    AUTH_REMEMBER_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
    WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
  })
  .superRefine((v, ctx) => {
    // Cookie с SameSite=None браузеры отбрасывают, если нет Secure, — сочетание
    // none+insecure молча убило бы все сессии.
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
      // Никогда не выводим сырые значения секретов в ошибках
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
