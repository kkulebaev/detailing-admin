import { z } from 'zod'
import { READINESS } from './enums.js'
import { parseDdmmyyyy } from './date.js'
import { normalizePhone } from './phone.js'

const ddmmyyyy = z
  .string()
  .max(10)
  .regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Укажите дату в формате ДД.ММ.ГГГГ')
const hhmm = z
  .string()
  .max(5)
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ')

// Класс кузова (I–IV). Отправляется в составе `bookingSchema`; бэкенд пока его
// игнорирует, но прайс-лист хранит диапазон цен на каждый класс, и пикер формы
// по нему показывает нужную колонку.
export const carClassSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)], {
  error: () => 'Выберите класс кузова',
})
export type CarClass = z.infer<typeof carClassSchema>
export const DEFAULT_CAR_CLASS: CarClass = 2

// Верхний предел числа мастеров в одной записи. Проверяется в схеме на проводе
// (ниже) и продублирован лимитом мультиселекта в UI.
export const MAX_MASTERS = 5

export const bookingSchema = z
  .object({
    dateFrom: ddmmyyyy,
    dateTo: ddmmyyyy.optional(),
    time: hhmm,
    timeTo: hhmm.optional(),
    name: z.string().min(1, 'Укажите имя').max(120),
    phone: z.string().min(1, 'Укажите номер телефона').max(40),
    car: z.string().min(1, 'Укажите марку и модель').max(200),
    // Гос. номер — отдельным полем: форма шлет его сырым, склейка с `car` для
    // колонки E и зеркала `bookings.car` делается на сервере через joinCar.
    // Нестрогое (как остальные поля) — строгой валидации формата номера нет.
    plate: z.string().max(32).optional(),
    service: z.string().min(1, 'Укажите услугу').max(2000),
    note: z.string().max(2000).default(''),
    amount: z
      .union([z.literal(''), z.number().int().nonnegative()])
      .refine((v) => typeof v === 'number', { error: 'Укажите сумму' }),
    // Необязательная арифметическая раскладка для ячейки «Сумма», напр. "=2000+3000-950".
    // Если есть, пишется в колонку H как есть (Sheets вычисляет ее под
    // USER_ENTERED); авторитетным числом остается `amount`. Ограничена цифрами
    // и арифметическими операторами, чтобы клиент не мог внедрить живую функцию
    // Sheets (IMPORTRANGE, HYPERLINK, …) в лист — источник истины.
    amountFormula: z
      .string()
      .max(2000)
      .regex(/^=[\d+\-*/().\s]+$/, 'Некорректная формула суммы')
      .optional(),
    readiness: z.enum(READINESS).or(z.literal('')).default(''),
    // Мастер/ответственный — произвольные строки, берутся в рантайме из таблицы
    // `masters`, а не из закрытого enum. Refine возвращает защиту от инъекций,
    // которую раньше давал enum: ведущий =/+/-/@ позволил бы отвергнутому значению
    // из списка протащить живую формулу в колонки J/K под USER_ENTERED.
    // Несколько мастеров: N мастеров на запись. Каждый элемент сохраняет ту же
    // защиту от инъекций (ведущий =/+/-/@ протаскивает живую формулу в
    // колонку J под USER_ENTERED). Дедупликация идет до проверки длины, чтобы
    // повторный выбор не засчитывался в MAX_MASTERS.
    master: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Выберите мастера')
          .max(120)
          .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя'),
      )
      .transform((arr) => [...new Set(arr)])
      .pipe(z.array(z.string()).min(1, 'Выберите хотя бы одного мастера').max(MAX_MASTERS)),
    // Форма начинает с undefined в этом поле, а его `.min()` ниже никогда не видит.
    responsible: z
      .string({ error: 'Выберите ответственного' })
      .trim()
      .min(1, 'Выберите ответственного')
      .max(120)
      .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя'),
    carClass: carClassSchema,
    // Если true, бэкенд шлет уведомление в Telegram назначенному мастеру после
    // того, как запись попала в Sheets. Best-effort — никогда не блокирует
    // запись и не сериализуется в строку листа (см. bookingToRow).
    notify: z.boolean().default(false),
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
      // Если диапазон схлопывается в один день, отбрасываем и время окончания —
      // в строке без диапазона ему не место.
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
