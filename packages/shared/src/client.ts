import { z } from 'zod'
import { normalizePhone } from './phone.js'
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

export const clientInputSchema = z
  .object({
    name: z.string().max(120).default(''),
    phone: z.string().min(1, 'Укажите номер телефона').max(40),
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
      return { name: v.name.trim(), phone }
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
