import { z } from 'zod'
import {
  changePasswordResponseSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  type ChangePasswordRequest,
  type LoginRequest,
} from '@detailing-admin/shared'
import { orvalFetch, type OrvalEnvelope } from './orval-mutator'

export type LoginResult = z.infer<typeof loginResponseSchema>
export type MeResult = z.infer<typeof meResponseSchema>
export type LogoutResult = z.infer<typeof logoutResponseSchema>
export type ChangePasswordResult = z.infer<typeof changePasswordResponseSchema>

// Auth routes ship ahead of the generated orval client (no OpenAPI regen in
// this change) — call orvalFetch directly, the way `api.ts submitBooking`
// calls its generated function. Unlike `unwrap` (api-client.ts), which
// blindly casts `data`, responses here are `safeParse`d: a shape mismatch is
// security-relevant session state, so it must surface as an error rather than
// silently pass through and corrupt the store.
function parseResponse<T>(schema: z.ZodType<T>, envelope: OrvalEnvelope<unknown>): T {
  const result = schema.safeParse(envelope.data)
  if (!result.success) {
    throw new Error('Некорректный ответ сервера авторизации')
  }
  return result.data
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function login(payload: LoginRequest): Promise<LoginResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  return parseResponse(loginResponseSchema, envelope)
}

export async function logout(): Promise<LogoutResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/logout', { method: 'POST' })
  return parseResponse(logoutResponseSchema, envelope)
}

export async function me(): Promise<MeResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/me')
  return parseResponse(meResponseSchema, envelope)
}

export async function changePassword(payload: ChangePasswordRequest): Promise<ChangePasswordResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  return parseResponse(changePasswordResponseSchema, envelope)
}
