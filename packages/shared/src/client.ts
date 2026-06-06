import { z } from 'zod'
import { normalizePhone } from './phone.js'

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
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Укажите номер телефона',
        })
        return z.NEVER
      }
      return { name: v.name.trim(), phone }
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: e instanceof Error ? e.message : 'Неверный номер',
      })
      return z.NEVER
    }
  })

export type ClientInput = z.infer<typeof clientInputSchema>
