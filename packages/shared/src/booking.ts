import { z } from 'zod'
import { READINESS, MASTERS } from './enums.js'
import { parseDdmmyyyy } from './date.js'
import { normalizePhone } from './phone.js'

const ddmmyyyy = z.string().max(10).regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Укажите дату в формате ДД.ММ.ГГГГ')
const hhmm = z.string().max(5).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ')
// Empty string passes through; non-empty must match HH:MM.
const optionalHhmm = z
  .string()
  .max(5)
  .refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Укажите время в формате ЧЧ:ММ')

export const bookingSchema = z
  .object({
    dateFrom: ddmmyyyy,
    dateTo: ddmmyyyy.optional(),
    time: optionalHhmm.default(''),
    timeTo: hhmm.optional(),
    name: z.string().max(120).default(''),
    phone: z.string().max(40).default(''),
    car: z.string().max(200).default(''),
    service: z.string().max(2000).default(''),
    note: z.string().max(2000).default(''),
    amount: z.union([z.literal(''), z.number().int().nonnegative()]).default(''),
    readiness: z.enum(READINESS).or(z.literal('')).default(''),
    master: z.enum(MASTERS).or(z.literal('')).default(''),
    responsible: z.enum(MASTERS).or(z.literal('')).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.dateTo) {
      const from = parseDdmmyyyy(v.dateFrom)
      const to = parseDdmmyyyy(v.dateTo)
      if (to.getTime() < from.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateTo'],
          message: 'Конец диапазона раньше начала',
        })
      }
    }
  })
  .transform((b, ctx) => {
    try {
      const phone = normalizePhone(b.phone)
      const sameDay = b.dateTo && b.dateTo === b.dateFrom
      const dateTo = sameDay ? undefined : b.dateTo
      // If we're collapsing the range to a single day, drop the end-time too —
      // it has no place on a non-range row.
      const timeTo = sameDay ? undefined : b.timeTo
      return { ...b, phone, dateTo, timeTo }
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: e instanceof Error ? e.message : 'Неверный номер',
      })
      return z.NEVER
    }
  })

export type Booking = z.infer<typeof bookingSchema>
