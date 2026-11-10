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
  // ISO datetime после JSON-сериализации (колонка в БД — timestamp).
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

// Клиента нельзя удалить, пока на него ссылается хоть одна запись — зеркало
// bookings сохраняется (его строки несут собственные телефон/имя), поэтому удаление
// отклоняется, а не каскадится и не оставляет связь висящей.
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

// Агрегаты за все время только по «Выдана» для карточки клиента. `totalSpent`/`visitCount`
// считаются по тому же правилу «Выдана», что и аналитика, но без окна периода, поэтому
// числа не обязаны совпадать с `/analytics` за период. `lastVisit`/`firstVisit` —
// ISO `YYYY-MM-DD` (или null, если у клиента нет выданных записей). API приводит
// строковые агрегаты postgres-js через Number() до сборки ответа.
export const clientStatsSchema = z.object({
  totalSpent: z.number(),
  visitCount: z.number(),
  lastVisit: z.string().nullable(),
  firstVisit: z.string().nullable(),
})

export type ClientStats = z.infer<typeof clientStatsSchema>

// Данные карточки клиента: клиент (с машинами), статистика за все время и полная
// история записей (все статусы) на общей `bookingRowSchema`.
// `bookingsTruncated` отмечает, что история уперлась в серверный лимит.
export const clientDetailOkSchema = z.object({
  ok: z.literal(true),
  client: clientSchema,
  stats: clientStatsSchema,
  bookings: z.array(bookingRowSchema),
  bookingsTruncated: z.boolean(),
})

export type ClientDetailOk = z.infer<typeof clientDetailOkSchema>

// `validationErrorSchema` обязательна: на кривой uuid роут возвращает 400,
// и веб-сторонний `ClientDetailResult` должен уметь это представить.
export const clientDetailResponseSchema = z.union([
  clientDetailOkSchema,
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type ClientDetailResponse = z.infer<typeof clientDetailResponseSchema>

// Только точный телефон, в отличие от поиска по подстроке `q` в списке: эндпоинт открыт
// не только админам, и он не должен служить способом листать клиентскую базу.
export const clientLookupQuerySchema = z.object({
  phone: z.string().regex(/^\+7\d{10}$/),
})

export const clientLookupSummarySchema = z.object({
  visitCount: z.number(),
  lastVisit: z.string().nullable(),
  // Отправляется только админам; именно его отсутствие убирает поле с формы booker'а.
  totalSpent: z.number().optional(),
  lastService: z.string().nullable(),
  missed: z.object({ cancelled: z.number(), noShow: z.number(), lastDate: z.string() }).nullable(),
})

export type ClientLookupSummary = z.infer<typeof clientLookupSummarySchema>

export const clientLookupOkSchema = z.object({
  ok: z.literal(true),
  match: z.object({ client: clientSchema, summary: clientLookupSummarySchema }).nullable(),
})

export type ClientLookupMatch = NonNullable<z.infer<typeof clientLookupOkSchema>['match']>

export const clientLookupResponseSchema = z.union([
  clientLookupOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// Одна машина в том виде, в каком ее отправляет диалог клиента. В отличие от `carSchema`
// (сохраненная строка с `id`), это форма для записи: без id, номер необязателен. db-слой
// нормализует и дедуплицирует — здесь проверяется только непустая марка/модель.
export const carInputSchema = z.object({
  makeModel: z.string().trim().min(1, 'Укажите марку и модель').max(200),
  plate: z.string().trim().max(32).default(''),
})

export type CarInput = z.infer<typeof carInputSchema>

export const clientInputSchema = z
  .object({
    name: z.string().max(120).default(''),
    phone: z.string().min(1, 'Укажите номер телефона').max(40),
    // Семантика полной замены: присланный список авторитетен, синхронизация в БД
    // приводит строки клиента ровно к этому набору.
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
