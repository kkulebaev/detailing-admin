import { z } from 'zod'

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)

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
    // Прием апдейтов бота (привязка Telegram) long polling'ом из этого процесса. По
    // умолчанию выключен: локальный .env с токеном чужого бота иначе забирал бы его
    // апдейты. Включается явно в prod и у dev-бота.
    TELEGRAM_POLLING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    // Web Push необязателен: без ключей push выключен, а старт не падает. Пустая строка
    // из .env.example значит то же, что отсутствие переменной.
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    // Должен быть настоящим mailto: или https: — на заглушку вроде localhost Apple
    // отвечает 403 BadJwtToken.
    VAPID_SUBJECT: optionalString,
    // Sentry необязателен: без DSN ошибки никуда не отправляются.
    SENTRY_DSN: optionalString.pipe(z.url().optional()),
    // Задает сам Railway; помечают события окружением и коммитом деплоя.
    RAILWAY_ENVIRONMENT_NAME: optionalString,
    RAILWAY_GIT_COMMIT_SHA: optionalString,
  })
  .superRefine((v, ctx) => {
    // Половина ключей — ошибка конфигурации, а не «push выключен»: без проверки такой
    // деплой молча остался бы без пушей.
    const vapid = [v.VAPID_PUBLIC_KEY, v.VAPID_PRIVATE_KEY, v.VAPID_SUBJECT]
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PRIVATE_KEY'],
        message: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together',
      })
    }
    if (v.VAPID_SUBJECT && !/^(mailto:|https:)/.test(v.VAPID_SUBJECT)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_SUBJECT'],
        message: 'must start with mailto: or https:',
      })
    }
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
        path === 'JWT_SECRET' ||
        path === 'VAPID_PRIVATE_KEY'
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
