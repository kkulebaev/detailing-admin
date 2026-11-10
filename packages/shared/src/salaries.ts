import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Строгая календарная дата ISO (YYYY-MM-DD). Regex фиксирует форму; refine
// отсекает невозможные даты (напр. 2026-02-31): прогоняет через Date туда и обратно
// и проверяет, что части уцелели, — тот же приём, что в parseDdmmyyyy.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате ГГГГ-ММ-ДД')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y!, m! - 1, d!))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d
  }, 'Недопустимая дата')

// "YYYY-MM". Regex запрещает месяц 00 и 13+; полуоткрытый диапазон
// [YYYY-MM-01, следующий месяц) выводит monthRange() ниже.
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц должен быть в формате ГГГГ-ММ')

const workHoursNote = z.string().max(500)
// Шаг в 15 минут сохраняет точность пересчёта минуты↔часы туда и обратно в UI.
const workHours = z.number().positive().max(24).multipleOf(0.25)

const payoutNote = z.string().max(500)
// Целые рубли со знаком. min/max попадают в OpenAPI как minimum/maximum и заодно
// страхуют от случайно вписанной лишней цифры. Правило «не ноль» живёт в refine
// (который в спецификацию не попадает) и продублировано CHECK в БД.
const payoutAmount = z
  .number()
  .int('Сумма должна быть целым числом рублей')
  .min(-10_000_000, 'Слишком большая сумма')
  .max(10_000_000, 'Слишком большая сумма')
  .refine((v) => v !== 0, 'Сумма не может быть нулевой')

export const rateInputSchema = z.object({
  masterId: z.number().int().positive(),
  // min(1): нулевая ставка молча обнулила бы зарплату через нулевой снапшот; состояние
  // «ставки нет» кодируется отсутствием строки в master_rates, но никогда не нулём.
  hourlyRate: z.number().int().min(1),
})

export type RateInput = z.infer<typeof rateInputSchema>

export const workHoursInputSchema = z.object({
  masterId: z.number().int().positive(),
  workDate: isoDate,
  hours: workHours,
  note: workHoursNote.optional(),
})

export type WorkHoursInput = z.infer<typeof workHoursInputSchema>

// Правка записи никогда не переснимает ставку, поэтому masterId и ставки здесь
// нет по построению — меняются только день/часы/заметка.
export const workHoursUpdateSchema = z.object({
  workDate: isoDate.optional(),
  hours: workHours.optional(),
  note: workHoursNote.optional(),
})

export type WorkHoursUpdate = z.infer<typeof workHoursUpdateSchema>

// Сотрудник вносит свои часы: мастер берётся из привязки аккаунта, а не из тела
// запроса, поэтому один аккаунт не может внести часы за кого-то другого.
export const selfWorkHoursInputSchema = workHoursInputSchema.omit({ masterId: true })

export type SelfWorkHoursInput = z.infer<typeof selfWorkHoursInputSchema>

// Разовые выплаты, не связанные с отработанными часами: премии, компенсации и
// (отрицательные) удержания. Ставка не участвует — сумма самостоятельна.
export const payoutInputSchema = z.object({
  masterId: z.number().int().positive(),
  payoutDate: isoDate,
  amount: payoutAmount,
  note: payoutNote.optional(),
})

export type PayoutInput = z.infer<typeof payoutInputSchema>

// Мастер при правке не меняется — тот же контракт, что у рабочих часов.
export const payoutUpdateSchema = z.object({
  payoutDate: isoDate.optional(),
  amount: payoutAmount.optional(),
  note: payoutNote.optional(),
})

export type PayoutUpdate = z.infer<typeof payoutUpdateSchema>

// ---- Схемы объектов ответа ----

export const salaryRowSchema = z.object({
  masterId: z.number().int(),
  masterName: z.string(),
  // null, когда у мастера ещё нет строки ставки — это не то же, что ставка 0.
  hourlyRate: z.number().int().nullable(),
  totalMinutes: z.number().int(),
  // Оплата часов: round(Σ(minutes × rate_snapshot) / 60), одно округление на
  // месяц. Называется `hoursSalary`, а не `salary`, потому что это уже не вся
  // зарплата — только её почасовая часть.
  hoursSalary: z.number().int(),
  // Сумма разовых выплат за месяц; 0 значит и «строк нет», и «строки взаимно
  // погасились» — единое соглашение для «нет строк за период».
  payoutsTotal: z.number().int(),
  total: z.number().int(),
})

export type SalaryRow = z.infer<typeof salaryRowSchema>

// Сохранённая запись work_hours со снапшотом ставки, снятым при вставке.
// `createdAt` после JSON-сериализации — строка ISO datetime.
export const workHoursSchema = z.object({
  id: z.number().int(),
  masterId: z.number().int(),
  workDate: z.string(),
  minutes: z.number().int(),
  rateSnapshot: z.number().int(),
  note: z.string(),
  createdAt: z.string(),
})

export type WorkHours = z.infer<typeof workHoursSchema>

// Сохранённая запись payouts. Снапшота ставки нет по построению.
export const payoutSchema = z.object({
  id: z.number().int(),
  masterId: z.number().int(),
  payoutDate: z.string(),
  amount: z.number().int(),
  note: z.string(),
  createdAt: z.string(),
})

export type Payout = z.infer<typeof payoutSchema>

// ---- Детальная лента ----

// Часы и выплаты хранятся и пишутся раздельно, но читаются одной отсортированной
// лентой: детальному виду мастера незачем знать, из скольких таблиц она собрана.
// Элементы ленты сохраняют имена полей исходной сущности (workDate /
// payoutDate), а не получают третье имя.
export const hoursEntrySchema = workHoursSchema.extend({ kind: z.literal('hours') })
export const payoutEntrySchema = payoutSchema.extend({ kind: z.literal('payout') })
export const salaryEntrySchema = z.discriminatedUnion('kind', [hoursEntrySchema, payoutEntrySchema])

export type HoursEntry = z.infer<typeof hoursEntrySchema>
export type PayoutEntry = z.infer<typeof payoutEntrySchema>
export type SalaryEntry = z.infer<typeof salaryEntrySchema>

// Предусловие POST /hours: добавление часов мастеру, у которого ещё нет ставки. Доменная
// ошибка, отдаваемая как ответ в духе валидации с литералом `reason` —
// той же формы, что invalid_order у мастеров (не список issues от zod).
export const workHoursNoRateSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.literal('no_rate'),
})

export const salariesListResponseSchema = z.union([
  z.object({ ok: z.literal(true), month: z.string(), rows: z.array(salaryRowSchema) }),
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const salaryEntriesListResponseSchema = z.union([
  z.object({ ok: z.literal(true), entries: z.array(salaryEntrySchema) }),
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const rateMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workHoursMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), hours: workHoursSchema }),
  validationErrorSchema,
  workHoursNoRateSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workHoursDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// Варианта no_rate нет: выплате ставка не нужна (§0.3).
export const payoutMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), payout: payoutSchema }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const payoutDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// ---- «Мои часы» (собственная зарплата сотрудника) ----

export const mySalaryOkSchema = salaryRowSchema.omit({ masterId: true, masterName: true }).extend({
  ok: z.literal(true),
  month: z.string(),
  // Null, пока аккаунт не привязан к мастеру: страница объясняет это,
  // а не показывает нули.
  master: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  entries: z.array(salaryEntrySchema),
  // Включительный ISO-диапазон, в котором сотрудник может добавлять, править и удалять
  // часы. Его присылает сервер, чтобы страница никогда не вычисляла «сегодня» не в том
  // часовом поясе.
  editableFrom: z.string(),
  editableTo: z.string(),
})

export type MySalaryOk = z.infer<typeof mySalaryOkSchema>

export const mySalaryResponseSchema = z.union([
  mySalaryOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// Доменные отказы в самостоятельной правке часов, той же формы «валидация с reason»,
// что и no_rate: у аккаунта нет мастера или день вне окна.
export const selfWorkHoursErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.enum(['no_rate', 'not_linked', 'outside_window']),
})

export const myWorkHoursMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), hours: workHoursSchema }),
  validationErrorSchema,
  selfWorkHoursErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const myWorkHoursDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  selfWorkHoursErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// ---- Чистые хелперы (покрыты юнит-тестами) ----

// Насколько далеко назад сотрудник может трогать свои часы, включая сегодня. Более
// ранние дни относятся к месяцу, который админ, возможно, уже выплатил.
export const SELF_EDIT_WINDOW_DAYS = 7

// Арифметика в UTC над значением «только дата»: никакой переход на летнее время
// не сдвинет его через границу дня.
function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

export function selfEditWindow(today: string): { from: string; to: string } {
  return { from: shiftIsoDate(today, -(SELF_EDIT_WINDOW_DAYS - 1)), to: today }
}

export function isInSelfEditWindow(date: string, today: string): boolean {
  const { from, to } = selfEditWindow(today)
  return date >= from && date <= to
}

// Часы (в UI шаг 0.25) → минуты. Math.round защищает от «пыли» float при
// умножении (напр. 7.51 → 451, а не 450).
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

export function minutesToHours(minutes: number): number {
  return minutes / 60
}

// Примитив единственного округления, общий для пути через SQL-агрегат (db-слой) и
// построчного computeSalary ниже: один Math.round над Σ(minutes×rate)/60.
// minutesRateSum — точное целое (₽·мин); округление до целых рублей происходит
// здесь, раз в месяц — никогда не построчно.
export function salaryFromMinutesRateSum(minutesRateSum: number): number {
  return Math.round(minutesRateSum / 60)
}

// Зарплата из детальных строк, округлённая ОДИН раз по итогу месяца — чтобы итоги в шапке
// совпадали с суммой детальных составляющих. Две строки по 25 мин при 100 ₽/ч должны дать
// round(5000/60)=83, а не round(2500/60)*2=84.
export function computeSalary(entries: Array<{ minutes: number; rate: number }>): number {
  const minutesRateSum = entries.reduce((acc, e) => acc + e.minutes * e.rate, 0)
  return salaryFromMinutesRateSum(minutesRateSum)
}

// Дата элемента ленты: workDate для часов, payoutDate для выплат.
export function salaryEntryDate(e: SalaryEntry): string {
  return e.kind === 'hours' ? e.workDate : e.payoutDate
}

// Хронологически внутри месяца; в один день часы идут раньше выплат, дальше
// по id — порядок детерминирован, и строки не прыгают при перезапросе.
// Слияние делается здесь, а не в SQL: UNION ALL потребовал бы хрупких приведений
// колонок, чтобы втиснуть обе формы в одну.
export function mergeSalaryEntries(hours: WorkHours[], payouts: Payout[]): SalaryEntry[] {
  const entries: SalaryEntry[] = [
    ...hours.map((h) => ({ ...h, kind: 'hours' as const })),
    ...payouts.map((p) => ({ ...p, kind: 'payout' as const })),
  ]
  return entries.sort((a, b) => {
    const byDate = salaryEntryDate(a).localeCompare(salaryEntryDate(b))
    if (byDate !== 0) return byDate
    if (a.kind !== b.kind) return a.kind === 'hours' ? -1 : 1
    return a.id - b.id
  })
}

// Месяц "YYYY-MM" → полуоткрытый ISO-диапазон дат [первый день, первый день следующего
// месяца). Декабрь перекатывается в январь следующего года (+1 год). Не зависит от часового
// пояса: только части строки, как и хранение в колонке `date`.
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const nextY = m === 12 ? y! + 1 : y!
  const nextM = m === 12 ? 1 : m! + 1
  const end = `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}-01`
  return { start, end }
}
