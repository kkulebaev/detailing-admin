import { z } from 'zod'
import { READINESS } from './enums.js'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Форма сохраненной записи на проводе, как ее отдает `GET /api/bookings`. Повторяет
// таблицу `bookings` без внутреннего `idempotencyKey`. Даты — ISO-строки
// (`YYYY-MM-DD`); `createdAt` после JSON-сериализации — ISO datetime.
export const bookingRowSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  name: z.string(),
  phone: z.string(),
  car: z.string(),
  service: z.string(),
  note: z.string(),
  // Опускается (undefined) для ролей, кроме админа: суммы видит только админ.
  // У админов присутствует.
  amount: z.number().int().optional(),
  amountFormula: z.string().nullable().optional(),
  dateFrom: z.string(),
  dateTo: z.string().nullable(),
  timeFrom: z.string(),
  timeTo: z.string().nullable(),
  // Сужено до enum READINESS (или '' для «нет статуса»), чтобы тип на проводе —
  // и сгенерированный orval клиент — несли конкретный union, а не голую строку.
  // Колонка в БД — свободный текст, но ни один роут не валидирует ответ в рантайме,
  // так что это сужение только на уровне типов.
  readiness: z.enum(READINESS).or(z.literal('')),
  master: z.array(z.string()),
  responsible: z.string(),
  carClass: z.number().int(),
  sheetRow: z.number().int().nullable(),
  sheetRange: z.string().nullable(),
  createdAt: z.string(),
})

export type BookingRow = z.infer<typeof bookingRowSchema>

export const bookingsListOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(bookingRowSchema),
  total: z.number().int(),
})

export const bookingsListResponseSchema = z.union([
  bookingsListOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingsListResponse = z.infer<typeof bookingsListResponseSchema>

export const bookingMutationOkSchema = z.object({ ok: z.literal(true), booking: bookingRowSchema })

export const bookingMutationResponseSchema = z.union([
  bookingMutationOkSchema,
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingMutationResponse = z.infer<typeof bookingMutationResponseSchema>

export const bookingDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingDeleteResponse = z.infer<typeof bookingDeleteResponseSchema>

// Тело быстрой inline-смены готовности (PATCH /api/bookings/{id}/readiness).
export const bookingReadinessInputSchema = z.object({
  readiness: z.enum(READINESS).or(z.literal('')),
})

export type BookingReadinessInput = z.infer<typeof bookingReadinessInputSchema>

// ── Аналитика (GET /api/analytics/overview) ────────────────────────────────
// Контракт на проводе для страницы аналитики (только для админа). Каждое числовое
// поле — обычный `number`: API приводит строковые агрегаты, которые отдает postgres-js
// (SUM/COUNT приходят строками), через Number() до сборки ответа — с объявленным
// типом `number` веб-клиент ведет арифметику (avgCheck, Δ%, repeatRate, расчеты
// графиков), и строковый операнд молча испортил бы результат.

export const analyticsGranularitySchema = z.enum(['day', 'week', 'month'])

export type AnalyticsGranularity = z.infer<typeof analyticsGranularitySchema>

// Одна точка ряда выручки, дополненного нулями. `revenue` учитывает только записи
// «Выдана»; `count` — объем (все статусы) в корзине — знаменатели намеренно
// разные (см. db-слой API).
export const analyticsSeriesPointSchema = z.object({
  bucket: z.string(),
  revenue: z.number(),
  count: z.number(),
})

export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>

// Строка топа клиентов. Группировка ограничена строками «Выдана», поэтому клиент без
// выданных машин за период в топ не попадает (а период без выдач дает пустой топ).
export const analyticsTopClientSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  sum: z.number(),
  visits: z.number(),
})

export type AnalyticsTopClient = z.infer<typeof analyticsTopClientSchema>

export const analyticsOverviewOkSchema = z.object({
  ok: z.literal(true),
  period: z.object({
    from: z.string(),
    to: z.string(),
    granularity: analyticsGranularitySchema,
  }),
  revenue: z.object({
    total: z.number(),
    avgCheck: z.number(),
    completedCount: z.number(),
    bookingsCount: z.number(),
    delta: z.object({
      // null, когда предыдущий период ничего не заработал (осмысленного % нет).
      revenuePct: z.number().nullable(),
      prevTotal: z.number(),
    }),
    series: z.array(analyticsSeriesPointSchema),
  }),
  clients: z.object({
    newCount: z.number(),
    returningCount: z.number(),
    noClientCount: z.number(),
    // null, когда нет клиентов, к которым можно отнести записи (пустой знаменатель).
    repeatRate: z.number().nullable(),
    topBySum: z.array(analyticsTopClientSchema),
  }),
})

export type AnalyticsOverviewOk = z.infer<typeof analyticsOverviewOkSchema>

export const analyticsOverviewResponseSchema = z.union([
  analyticsOverviewOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type AnalyticsOverviewResponse = z.infer<typeof analyticsOverviewResponseSchema>
