import { z } from 'zod'
import { normalizePhone } from './phone.js'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

export const clientSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  name: z.string(),
})

export type Client = z.infer<typeof clientSchema>

const clientConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('duplicate_phone'),
})

export const clientsListResponseSchema = z.union([
  z.object({ ok: z.literal(true), clients: z.array(clientSchema) }),
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
