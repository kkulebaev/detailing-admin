import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Доменный объект — повторяет строку таблицы `masters` в том виде, как ее сериализует API.
export const masterSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  position: z.number().int(),
  canBeResponsible: z.boolean(),
  // Получает ли мастер зарплату — страница «Зарплаты» показывает только таких.
  paidSalary: z.boolean(),
  // Nullable — зарезервировано под будущие уведомления в Telegram; в лист не попадает.
  telegramId: z.string().nullable(),
  // Аккаунт, который вносит часы за этого мастера в «Мои часы». Null — такого нет.
  userId: z.string().uuid().nullable(),
})

export type Master = z.infer<typeof masterSchema>

// Те же trim/min/max/refine, что у поля мастера в записи — refine защищает от инъекций
// лист — источник истины (никаких ведущих =/+/-/@).
const masterName = z
  .string()
  .trim()
  .min(1, 'Укажите имя мастера')
  .max(120)
  .refine((v) => !/^[=+\-@]/.test(v), 'Недопустимое имя')

// Семантика полной замены намеренна: у `canBeResponsible` нет `.default()`. Эта
// схема обслуживает и POST, и PATCH /api/masters/{id} — пропущенный флаг в PATCH
// должен проваливать валидацию, а не молча воскрешаться в `true`. Форма всегда
// шлет флаг, так что UX создания не меняется. `telegramId` принимает null
// (или строку) — refine от инъекций не нужен, в лист он не попадает.
export const masterInputSchema = z.object({
  name: masterName,
  canBeResponsible: z.boolean(),
  paidSalary: z.boolean(),
  telegramId: z.string().max(64).nullable(),
  userId: z.string().uuid().nullable(),
})

export type MasterInput = z.infer<typeof masterInputSchema>

export const reorderInputSchema = z.object({
  ids: z.array(z.number().int().positive()),
})

export type ReorderInput = z.infer<typeof reorderInputSchema>

// duplicate_user: аккаунт уже привязан к другому мастеру — один аккаунт вносит
// часы ровно за одного мастера. archived_name: имя принадлежит удаленному
// мастеру, чья строка остается в таблице.
export const masterConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.union([
    z.literal('duplicate_name'),
    z.literal('archived_name'),
    z.literal('duplicate_user'),
  ]),
})

// invalid_order — ошибка в духе валидации, специфичная для reorder: присланный
// набор id не совпадает с полным набором строк.
const masterInvalidOrderSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.literal('invalid_order'),
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
