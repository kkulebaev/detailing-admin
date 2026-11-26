import { z } from 'zod'
import { dbUnavailableErrorSchema, internalErrorSchema, validationErrorSchema } from './api.js'

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

// «24:00» допустимо, чтобы студию можно было закрыть ровно в полночь; работа
// через полночь не поддерживается: закрытие всегда позже открытия в тот же день.
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/

export const timeOfDaySchema = z.string().regex(TIME_OF_DAY, 'Время в формате ЧЧ:ММ')

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// weekday: 0 — понедельник, 6 — воскресенье, как в сетке графика.
export const studioDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opensAt: timeOfDaySchema,
    closesAt: timeOfDaySchema,
  })
  .refine((d) => timeToMinutes(d.opensAt) < timeToMinutes(d.closesAt), {
    path: ['closesAt'],
    message: 'Закрытие должно быть позже открытия',
  })

export type StudioDay = z.infer<typeof studioDaySchema>

// Хранятся только рабочие дни: дня недели нет в списке — студия в него закрыта.
// Пустой список значит «режим не задан», поэтому сохранить его нельзя.
export const studioHoursInputSchema = z.object({
  days: z
    .array(studioDaySchema)
    .min(1, 'Отметьте хотя бы один рабочий день')
    .max(7)
    .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, {
      message: 'День недели указан дважды',
    }),
})

export type StudioHoursInput = z.infer<typeof studioHoursInputSchema>

export const studioHoursOkSchema = z.object({
  ok: z.literal(true),
  days: z.array(studioDaySchema),
})

export const studioHoursResponseSchema = z.union([
  studioHoursOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// «Пн–Пт 09:00–21:00, Сб 10:00–18:00, Вс выходной»: соседние дни с одинаковыми
// часами сливаются в диапазон.
export function formatStudioHours(days: readonly StudioDay[]): string[] {
  const byWeekday = new Map(days.map((d) => [d.weekday, `${d.opensAt}–${d.closesAt}`]))
  const groups: { from: number; to: number; hours: string | null }[] = []
  for (let w = 0; w < 7; w++) {
    const hours = byWeekday.get(w) ?? null
    const last = groups[groups.length - 1]
    if (last && last.hours === hours) last.to = w
    else groups.push({ from: w, to: w, hours })
  }
  return groups.map((g) => {
    const name =
      g.from === g.to
        ? WEEKDAY_SHORT[g.from]
        : `${WEEKDAY_SHORT[g.from]}${g.to - g.from === 1 ? ', ' : '–'}${WEEKDAY_SHORT[g.to]}`
    return `${name} ${g.hours ?? 'выходной'}`
  })
}
