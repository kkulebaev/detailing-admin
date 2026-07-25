import { z } from 'zod'
import { READINESS } from './enums.js'
import { parseDdmmyyyy } from './date.js'
import { normalizePhone } from './phone.js'

const ddmmyyyy = z.string().max(10).regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Укажите дату в формате ДД.ММ.ГГГГ')
const hhmm = z.string().max(5).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ')

// Car body class (I–IV). Sent as part of `bookingSchema`; the backend currently
// ignores it, but the pricelist stores a price range per class and the form's
// picker uses it to show the right column.
export const carClassSchema = z.union(
  [z.literal(1), z.literal(2), z.literal(3), z.literal(4)],
  { error: () => 'Выберите класс кузова' },
)
export type CarClass = z.infer<typeof carClassSchema>
export const DEFAULT_CAR_CLASS: CarClass = 2

export const bookingSchema = z
  .object({
    dateFrom: ddmmyyyy,
    dateTo: ddmmyyyy.optional(),
    time: hhmm,
    timeTo: hhmm.optional(),
    name: z.string().min(1, 'Укажите имя').max(120),
    phone: z.string().min(1, 'Укажите номер телефона').max(40),
    car: z.string().min(1, 'Укажите марку и модель').max(200),
    service: z.string().min(1, 'Укажите услугу').max(2000),
    note: z.string().max(2000).default(''),
    amount: z
      .union([z.literal(''), z.number().int().nonnegative()])
      .refine((v) => typeof v === 'number', { error: 'Укажите сумму' }),
    // Optional arithmetic breakdown for the «Сумма» cell, e.g. "=2000+3000-950".
    // When present it's written to column H verbatim (Sheets evaluates it under
    // USER_ENTERED); `amount` stays the authoritative number. Constrained to
    // digits and arithmetic operators so a client can't inject a live Sheets
    // function (IMPORTRANGE, HYPERLINK, …) into the source-of-truth sheet.
    amountFormula: z
      .string()
      .max(2000)
      .regex(/^=[\d+\-*/().\s]+$/, 'Некорректная формула суммы')
      .optional(),
    readiness: z.enum(READINESS).or(z.literal('')).default(''),
    // Master/responsible are free-form strings sourced from the `masters` table
    // at runtime, not a closed enum. The refine restores the anti-injection
    // barrier the enum used to give: a leading =/+/-/@ would let a rejected
    // dropdown value smuggle a live formula into columns J/K under USER_ENTERED.
    master: z
      .string()
      .trim()
      .min(1, 'Выберите мастера')
      .max(120)
      .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя'),
    responsible: z
      .string()
      .trim()
      .min(1, 'Выберите ответственного')
      .max(120)
      .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя'),
    carClass: carClassSchema,
  })
  .superRefine((v, ctx) => {
    if (v.dateTo) {
      const from = parseDdmmyyyy(v.dateFrom)
      const to = parseDdmmyyyy(v.dateTo)
      if (to.getTime() < from.getTime()) {
        ctx.addIssue({
          code: 'custom',
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
        code: 'custom',
        path: ['phone'],
        message: e instanceof Error ? e.message : 'Неверный номер',
      })
      return z.NEVER
    }
  })

export type Booking = z.infer<typeof bookingSchema>
