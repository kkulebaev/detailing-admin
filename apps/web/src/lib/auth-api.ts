import { z } from 'zod'
import {
  changePasswordResponseSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  updateProfileResponseSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type UpdateProfileRequest,
} from '@detailing-admin/shared'
import { orvalFetch, type OrvalEnvelope } from './orval-mutator'

export type LoginResult = z.infer<typeof loginResponseSchema>
export type MeResult = z.infer<typeof meResponseSchema>
export type LogoutResult = z.infer<typeof logoutResponseSchema>
export type ChangePasswordResult = z.infer<typeof changePasswordResponseSchema>
export type UpdateProfileResult = z.infer<typeof updateProfileResponseSchema>

// Роуты авторизации появились раньше сгенерированного orval-клиента (в этом изменении
// OpenAPI не перегенерировался) — вызываем orvalFetch напрямую, как `api.ts submitBooking`
// вызывает свою сгенерированную функцию. В отличие от `unwrap` (api-client.ts), который
// слепо приводит `data`, ответы здесь проходят через `safeParse`: несовпадение формы
// затрагивает безопасность состояния сессии, поэтому должно всплыть ошибкой, а не
// молча пройти дальше и испортить store.
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

export async function updateProfile(payload: UpdateProfileRequest): Promise<UpdateProfileResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/me', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  return parseResponse(updateProfileResponseSchema, envelope)
}

export async function changePassword(
  payload: ChangePasswordRequest,
): Promise<ChangePasswordResult> {
  const envelope = await orvalFetch<OrvalEnvelope<unknown>>('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  return parseResponse(changePasswordResponseSchema, envelope)
}
