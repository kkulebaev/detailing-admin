import { z } from 'zod'
import { normalizePhone } from './phone.js'
import { bookingRowSchema } from './booking-row.js'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Одна машина клиента (строка `client_cars`). make/model и plate хранятся
// раздельно (структурные данные, не склеенная строка колонки E).
export const carSchema = z.object({
  id: z.string().uuid(),
  makeModel: z.string(),
  plate: z.string(),
})

export type Car = z.infer<typeof carSchema>

export const clientSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  name: z.string(),
  // ISO datetime after JSON serialization (the DB column is a timestamp).
  createdAt: z.string(),
  // Машины клиента, вложенные в list-ответ одним сгруппированным запросом.
  // Дефолт [] обязателен: clientSchema переиспользуется в
  // clientMutationResponseSchema — create/update-ответы (у нового клиента
  // машин нет) тоже валидны с cars: [].
  cars: z.array(carSchema).default([]),
})

export type Client = z.infer<typeof clientSchema>

const clientConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('duplicate_phone'),
})

// A client cannot be deleted while any booking still references it — the
// bookings mirror is retained (its rows carry their own phone/name), so the
// delete is refused instead of cascading or orphaning the link.
const clientDeleteConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('has_bookings'),
})

export const clientsListResponseSchema = z.union([
  z.object({ ok: z.literal(true), clients: z.array(clientSchema), total: z.number().int() }),
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const clientMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), client: clientSchema }),
  validationErrorSchema,
  clientConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const clientDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  clientDeleteConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// Lifetime «Выдана»-only aggregates for the client card. `totalSpent`/`visitCount`
// are the same «Выдана» rule as analytics but with no period window, so the numbers
// need not match a period-scoped `/analytics` view. `lastVisit`/`firstVisit` are
// ISO `YYYY-MM-DD` (or null when the client has no delivered bookings). The API
// coerces postgres-js string aggregates via Number() before building the response.
export const clientStatsSchema = z.object({
  totalSpent: z.number(),
  visitCount: z.number(),
  lastVisit: z.string().nullable(),
  firstVisit: z.string().nullable(),
})

export type ClientStats = z.infer<typeof clientStatsSchema>

// Client card payload: the client (with cars), lifetime stats, and the full
// booking history (all statuses) reusing the shared `bookingRowSchema`.
// `bookingsTruncated` flags that the history hit the server-side cap.
export const clientDetailOkSchema = z.object({
  ok: z.literal(true),
  client: clientSchema,
  stats: clientStatsSchema,
  bookings: z.array(bookingRowSchema),
  bookingsTruncated: z.boolean(),
})

export type ClientDetailOk = z.infer<typeof clientDetailOkSchema>

// `validationErrorSchema` is required: the route returns 400 on a malformed uuid,
// so the web-side `ClientDetailResult` must be able to represent it.
export const clientDetailResponseSchema = z.union([
  clientDetailOkSchema,
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type ClientDetailResponse = z.infer<typeof clientDetailResponseSchema>

// One car as submitted by the client dialog. Unlike `carSchema` (a persisted
// row, carries `id`), this is the write shape: no id, plate optional. The db
// layer normalizes/dedupes — here we only enforce a non-empty make/model.
export const carInputSchema = z.object({
  makeModel: z.string().trim().min(1, 'Укажите марку и модель').max(200),
  plate: z.string().trim().max(32).default(''),
})

export type CarInput = z.infer<typeof carInputSchema>

export const clientInputSchema = z
  .object({
    name: z.string().max(120).default(''),
    phone: z.string().min(1, 'Укажите номер телефона').max(40),
    // Full-replace semantics: the submitted list is authoritative, the db sync
    // reconciles the client's rows to exactly this set.
    cars: z.array(carInputSchema).default([]),
  })
  .transform((v, ctx) => {
    try {
      const phone = normalizePhone(v.phone)
      if (phone.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['phone'],
          message: 'Укажите номер телефона',
        })
        return z.NEVER
      }
      return { name: v.name.trim(), phone, cars: v.cars }
    } catch (e) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: e instanceof Error ? e.message : 'Неверный номер',
      })
      return z.NEVER
    }
  })

export type ClientInput = z.infer<typeof clientInputSchema>
