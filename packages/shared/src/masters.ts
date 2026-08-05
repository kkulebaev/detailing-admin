import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Domain object — mirrors a row of the `masters` table serialized by the API.
export const masterSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  position: z.number().int(),
  canBeResponsible: z.boolean(),
  // Whether the master is paid a salary — the Зарплаты page lists only paid ones.
  paidSalary: z.boolean(),
  // Nullable — reserved for future Telegram notifications; the sheet never sees it.
  telegramId: z.string().nullable(),
})

export type Master = z.infer<typeof masterSchema>

// Same trim/min/max/refine as the booking master field — the refine is the
// anti-injection barrier for the source-of-truth sheet (no leading =/+/-/@).
const masterName = z
  .string()
  .trim()
  .min(1, 'Укажите имя мастера')
  .max(120)
  .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя')

// Full-replace semantics on purpose: no `.default()` on `canBeResponsible`. This
// schema backs both POST and PATCH /api/masters/{id} — an omitted flag on PATCH
// must fail validation rather than silently resurrect to `true`. The form always
// sends the flag, so this doesn't change the create UX. `telegramId` accepts null
// (or a string) — no anti-injection refine since it never reaches the sheet.
export const masterInputSchema = z.object({
  name: masterName,
  canBeResponsible: z.boolean(),
  paidSalary: z.boolean(),
  telegramId: z.string().max(64).nullable(),
})

export type MasterInput = z.infer<typeof masterInputSchema>

export const reorderInputSchema = z.object({
  ids: z.array(z.number().int().positive()),
})

export type ReorderInput = z.infer<typeof reorderInputSchema>

const masterConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('duplicate_name'),
})

// invalid_order is a validation-flavoured error specific to reorder: the posted
// id set doesn't match the full set of rows.
const masterInvalidOrderSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.literal('invalid_order'),
})

// Delete-only conflict: the master is still pinned by recorded work_hours or by
// bookings linked via the id-link (junction / responsible_id). Refused instead
// of cascading so the live-name booking history stays intact.
const masterDeleteConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.union([z.literal('has_work_hours'), z.literal('has_bookings')]),
})

export const mastersListResponseSchema = z.union([
  z.object({ ok: z.literal(true), masters: z.array(masterSchema) }),
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const masterMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), master: masterSchema }),
  validationErrorSchema,
  masterConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const masterUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true), master: masterSchema }),
  validationErrorSchema,
  masterConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const masterDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  masterDeleteConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const masterReorderResponseSchema = z.union([
  z.object({ ok: z.literal(true), masters: z.array(masterSchema) }),
  validationErrorSchema,
  masterInvalidOrderSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])
