import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'
import { bookingMutationOkSchema, bookingRowSchema } from './booking-row.js'

export const BOOKING_AUDIT_ACTIONS = ['create', 'update', 'delete', 'restore'] as const

export type BookingAuditAction = (typeof BOOKING_AUDIT_ACTIONS)[number]

// Поля записи, изменения которых попадают в журнал. Производные id-связи
// (`clientId`, `carId`, `responsibleId`) не входят: они пересчитываются из снимков
// и только зашумили бы историю.
export const BOOKING_AUDITED_FIELDS = [
  'name',
  'phone',
  'car',
  'service',
  'note',
  'amount',
  'amountFormula',
  'dateFrom',
  'dateTo',
  'timeFrom',
  'timeTo',
  'readiness',
  'master',
  'responsible',
  'carClass',
] as const

export type BookingAuditedField = (typeof BOOKING_AUDITED_FIELDS)[number]

export const auditValueSchema = z.union([z.string(), z.number(), z.null(), z.array(z.string())])

export type AuditValue = z.infer<typeof auditValueSchema>

export const auditChangeSchema = z.object({
  field: z.string(),
  from: auditValueSchema,
  to: auditValueSchema,
})

export type AuditChange = z.infer<typeof auditChangeSchema>

export const bookingAuditEntrySchema = z.object({
  id: z.number().int(),
  action: z.enum(BOOKING_AUDIT_ACTIONS),
  actorLogin: z.string(),
  actorName: z.string(),
  at: z.string(),
  // Есть только у `update`.
  changes: z.array(auditChangeSchema).nullable(),
})

export type BookingAuditEntry = z.infer<typeof bookingAuditEntrySchema>

export const bookingHistoryOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(bookingAuditEntrySchema),
})

export const bookingHistoryResponseSchema = z.union([
  bookingHistoryOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingHistoryResponse = z.infer<typeof bookingHistoryResponseSchema>

export const deletedBookingSchema = z.object({
  booking: bookingRowSchema,
  deletedAt: z.string(),
  deletedBy: z.string(),
})

export type DeletedBooking = z.infer<typeof deletedBookingSchema>

export const deletedBookingsOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(deletedBookingSchema),
})

export const deletedBookingsResponseSchema = z.union([
  deletedBookingsOkSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type DeletedBookingsResponse = z.infer<typeof deletedBookingsResponseSchema>

// ── Общий журнал (GET /api/bookings/journal) ───────────────────────────────
// Лента действий по всем записям, свежие первыми. Сводка нужна, чтобы событие читалось
// без открытия записи; у удаленной записи она берется из снимка удаления.
export const bookingJournalSummarySchema = z.object({
  name: z.string(),
  car: z.string(),
  dateFrom: z.string(),
  dateTo: z.string().nullable(),
  timeFrom: z.string(),
})

export type BookingJournalSummary = z.infer<typeof bookingJournalSummarySchema>

export const bookingJournalEntrySchema = bookingAuditEntrySchema.extend({
  bookingId: z.string(),
  // null — записи нет в таблице и нет снимка ее удаления (такого быть не должно,
  // но журнал не должен падать из-за одной битой строки).
  booking: bookingJournalSummarySchema.nullable(),
  // Записи сейчас нет в таблице: она удалена и не восстановлена.
  deleted: z.boolean(),
})

export type BookingJournalEntry = z.infer<typeof bookingJournalEntrySchema>

export const bookingJournalOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(bookingJournalEntrySchema),
  hasMore: z.boolean(),
})

export const bookingJournalResponseSchema = z.union([
  bookingJournalOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingJournalResponse = z.infer<typeof bookingJournalResponseSchema>

// Двойной клик по «Восстановить» или вторая вкладка: запись уже вернулась в таблицу.
export const bookingRestoreConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('already_restored'),
})

export const bookingRestoreResponseSchema = z.union([
  bookingMutationOkSchema,
  validationErrorSchema,
  notFoundErrorSchema,
  bookingRestoreConflictSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export type BookingRestoreResponse = z.infer<typeof bookingRestoreResponseSchema>
