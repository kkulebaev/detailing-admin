import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'
import { isoDateSchema } from './salaries.js'

// Заявка — правка, а не целый график: квартала изменений хватает с запасом.
export const SCHEDULE_REQUEST_MAX_DAYS = 93
// Страница графика показывает 12 месяцев вперед; дальше просить незачем.
export const SCHEDULE_REQUEST_HORIZON_DAYS = 400
// Сотрудник видит свежие решения по своим заявкам, а не всю историю.
export const MY_SCHEDULE_REQUESTS_LIMIT = 10

export const SCHEDULE_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ScheduleRequestStatus = (typeof SCHEDULE_REQUEST_STATUSES)[number]

export const scheduleRequestDaySchema = z.object({
  date: isoDateSchema,
  working: z.boolean(),
})

export type ScheduleRequestDay = z.infer<typeof scheduleRequestDaySchema>

export const scheduleRequestInputSchema = z.object({
  days: z
    .array(scheduleRequestDaySchema)
    .min(1)
    .max(SCHEDULE_REQUEST_MAX_DAYS)
    .refine((days) => new Set(days.map((d) => d.date)).size === days.length, {
      message: 'Дни в заявке повторяются',
    }),
})

export type ScheduleRequestInput = z.infer<typeof scheduleRequestInputSchema>

export const scheduleRequestSchema = z.object({
  id: z.number().int(),
  masterId: z.number().int(),
  masterName: z.string(),
  status: z.enum(SCHEDULE_REQUEST_STATUSES),
  days: z.array(z.object({ date: z.string(), working: z.boolean() })),
  // Причина отказа от админа; null, если ее не оставили.
  comment: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
})

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>

// `today` — день студии с сервера, чтобы страница не считала «сегодня» по часам
// телефона. `masterId` равен null, пока аккаунт не привязан к мастеру.
export const myScheduleRequestsOkSchema = z.object({
  ok: z.literal(true),
  masterId: z.number().int().nullable(),
  today: z.string(),
  requests: z.array(scheduleRequestSchema),
})

export type MyScheduleRequestsOk = z.infer<typeof myScheduleRequestsOkSchema>

export const myScheduleRequestsResponseSchema = z.union([
  myScheduleRequestsOkSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const scheduleRequestRejectedErrorSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.enum(['not_linked', 'too_far']),
})

export const scheduleRequestConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  // pending_exists: у мастера уже есть заявка на согласовании, новую не подать, пока
  // ту не рассмотрят или не отзовут. already_decided: заявку уже одобрили или отклонили.
  reason: z.enum(['pending_exists', 'already_decided']),
})

export const scheduleRequestSubmitResponseSchema = z.union([
  z.object({ ok: z.literal(true), request: scheduleRequestSchema }),
  validationErrorSchema,
  scheduleRequestRejectedErrorSchema,
  scheduleRequestConflictSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const scheduleRequestsOkSchema = z.object({
  ok: z.literal(true),
  requests: z.array(scheduleRequestSchema),
})

export const scheduleRequestsResponseSchema = z.union([
  scheduleRequestsOkSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const scheduleRequestRejectInputSchema = z.object({
  comment: z.string().trim().max(500).optional(),
})

export type ScheduleRequestRejectInput = z.infer<typeof scheduleRequestRejectInputSchema>

// Ответ и на решение админа, и на отзыв заявки сотрудником.
export const scheduleRequestActionResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  notFoundErrorSchema,
  scheduleRequestConflictSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

// Прошлое просить можно — так мастер поправляет дни, которые отработал не по
// графику; решение все равно за админом. Ограничен только горизонт вперед.
export function scheduleRequestDatesProblem(
  dates: readonly string[],
  today: string,
): 'too_far' | null {
  const last = shiftIsoDate(today, SCHEDULE_REQUEST_HORIZON_DAYS)
  return dates.some((d) => d > last) ? 'too_far' : null
}
