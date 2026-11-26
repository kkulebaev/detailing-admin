import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'
import { isoDateSchema } from './salaries.js'
import { studioClosedErrorSchema } from './studio-hours.js'

// Хватает на квартал: странице нужен месяц, форме записи — месяцы ее дат.
export const SCHEDULE_MAX_RANGE_DAYS = 93

export const scheduleQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
})

export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>

// Хранятся только рабочие дни: день без строки — выходной.
export const masterScheduleSchema = z.object({
  masterId: z.number().int(),
  dates: z.array(z.string()),
})

export type MasterSchedule = z.infer<typeof masterScheduleSchema>

export const scheduleOkSchema = z.object({
  ok: z.literal(true),
  from: z.string(),
  to: z.string(),
  schedule: z.array(masterScheduleSchema),
})

export const scheduleListResponseSchema = z.union([
  scheduleOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const scheduleDayInputSchema = z.object({
  masterId: z.number().int().positive(),
  date: isoDateSchema,
  working: z.boolean(),
})

export type ScheduleDayInput = z.infer<typeof scheduleDayInputSchema>

// Месяц всех мастеров с запасом; больше за одно сохранение админ не наберет.
export const SCHEDULE_MAX_CHANGES = 1000

// Админ отмечает дни черновиком и сохраняет пачкой: одна транзакция, так что
// график не остается сохраненным наполовину.
export const scheduleUpdateInputSchema = z.object({
  days: z.array(scheduleDayInputSchema).min(1).max(SCHEDULE_MAX_CHANGES),
})

export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateInputSchema>

export const scheduleDayResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  studioClosedErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

function utcToIso(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

// Включительно с обеих сторон; пусто, если `to` раньше `from`. Ограничено
// SCHEDULE_MAX_RANGE_DAYS, чтобы опечатка в годе не разворачивала тысячи дней.
export function isoDaysBetween(from: string, to: string): string[] {
  const days: string[] = []
  const cur = isoToUtc(from)
  const end = isoToUtc(to)
  while (cur <= end && days.length < SCHEDULE_MAX_RANGE_DAYS) {
    days.push(utcToIso(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

export function scheduleRangeDays(from: string, to: string): number {
  return Math.round((isoToUtc(to).getTime() - isoToUtc(from).getTime()) / 86_400_000) + 1
}

// Первое число месяца `from` — последнее число месяца `to`. Форма записи грузит
// целые месяцы, как страница графика, чтобы они делили один кэш.
export function scheduleMonthsRange(from: string, to: string): ScheduleQuery {
  const end = isoToUtc(to)
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0))
  return { from: `${from.slice(0, 7)}-01`, to: utcToIso(last) }
}

export function monthScheduleRange(month: string): ScheduleQuery {
  return scheduleMonthsRange(`${month}-01`, `${month}-01`)
}

export interface MasterDaysOff {
  masterId: number
  dates: string[]
}

// Любой день без отметки — выходной, даже если месяц не заполнен вовсе: так
// предупреждение в форме записи напоминает составить график мастеру.
// `schedule` должен покрывать все даты от `from` до `to`.
export function findDaysOff(
  schedule: readonly MasterSchedule[],
  masterIds: readonly number[],
  from: string,
  to: string,
): MasterDaysOff[] {
  const days = isoDaysBetween(from, to)
  const result: MasterDaysOff[] = []
  for (const masterId of masterIds) {
    const working = new Set(schedule.find((s) => s.masterId === masterId)?.dates ?? [])
    const dates = days.filter((d) => !working.has(d))
    if (dates.length > 0) result.push({ masterId, dates })
  }
  return result
}
