import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  unauthorizedErrorSchema,
  validationErrorSchema,
} from './api.js'

export const ROLES = ['admin', 'employee'] as const
export const roleSchema = z.enum(ROLES)
export type Role = (typeof ROLES)[number]

// Public projection of a user — never carries the password hash.
export const userPublicSchema = z.object({
  login: z.string(),
  role: roleSchema,
})
export type UserPublic = z.infer<typeof userPublicSchema>

export const loginRequestSchema = z.object({
  login: z.string().min(1, 'Укажите логин').max(64),
  password: z.string().min(1, 'Укажите пароль').max(200),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Укажите текущий пароль').max(200),
    newPassword: z.string().min(8, 'Минимум 8 символов').max(200),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Новый пароль должен отличаться от текущего',
  })
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>

// `stale_password` (HTTP 409) is returned when a concurrent change-password won
// the conditional UPDATE (WHERE password_hash = <old>) — the current request's
// view of the password is stale and it must re-fetch/retry, not report success.
export const stalePasswordConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('stale_password'),
})

export const loginResponseSchema = z.union([
  z.object({ ok: z.literal(true), user: userPublicSchema }),
  validationErrorSchema,
  unauthorizedErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const meResponseSchema = z.union([
  z.object({ ok: z.literal(true), user: userPublicSchema }),
  unauthorizedErrorSchema,
])

export const logoutResponseSchema = z.object({ ok: z.literal(true) })

export const changePasswordResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  unauthorizedErrorSchema,
  stalePasswordConflictSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])
