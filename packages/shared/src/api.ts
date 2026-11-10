import { z } from 'zod'

// Общие строительные блоки ответов. Схема ответа каждого роута — union
// успешного варианта с этими схемами; они собраны здесь, чтобы формы ошибок
// на проводе жили в одном месте, а веб-сторона могла делать `safeParse`, а не каст.

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
})

export const validationErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  issues: z.array(validationIssueSchema),
})

export const internalErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('internal'),
})

export const notFoundErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('not_found'),
})

// 401 — сессии нет или она невалидна. Проверяется без состояния (без чтения из БД),
// поэтому возвращается, даже когда Postgres лежит.
export const unauthorizedErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('unauthorized'),
})

// 403 — пользователь аутентифицирован, но у его роли нет доступа к ресурсу.
export const forbiddenErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('forbidden'),
})

export const sheetsErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('sheets'),
  code: z.number().optional(),
  message: z.string(),
})

export const unavailableErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('unavailable'),
  reason: z.union([z.literal('headers_mismatch'), z.literal('not_configured')]),
  column_index: z.number().optional(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  message: z.string().optional(),
})

// Недоступность только БД (без `reason: 'headers_mismatch'` — это забота стороны Sheets).
export const dbUnavailableErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('unavailable'),
  reason: z.literal('not_configured').optional(),
  message: z.string(),
})

// Результат best-effort-уведомления в Telegram назначенному мастеру.
// Есть только когда клиент его запросил (`booking.notify`). `attempted`
// без `delivered` значит, что запись в Sheets прошла, но до мастера не
// достучались — веб-форма показывает это как предупреждение, а не ошибку.
export const notificationResultSchema = z.object({
  attempted: z.boolean(),
  delivered: z.boolean(),
  reason: z.string().optional(),
})

const bookingSuccessSchema = z.object({
  ok: z.literal(true),
  idempotent: z.boolean(),
  updatedRange: z.string(),
  updatedRow: z.number(),
  notification: notificationResultSchema.optional(),
})

export const bookingApiResultSchema = z.union([
  bookingSuccessSchema,
  validationErrorSchema,
  sheetsErrorSchema,
  internalErrorSchema,
  unavailableErrorSchema,
])

export type ValidationIssue = z.infer<typeof validationIssueSchema>
export type NotificationResult = z.infer<typeof notificationResultSchema>
export type BookingApiResult = z.infer<typeof bookingApiResultSchema>

// Устаревший обобщенный алиас — оставлен, чтобы старые места импорта компилировались.
// Предпочитайте схемы конкретных роутов рядом с их доменом (напр. clientMutationResponseSchema).
export type ApiResult<T> =
  | ({ ok: true } & T)
  | z.infer<typeof validationErrorSchema>
  | z.infer<typeof sheetsErrorSchema>
  | z.infer<typeof internalErrorSchema>
  | z.infer<typeof unavailableErrorSchema>
