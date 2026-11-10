import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import { roleSchema, type Role } from '@detailing-admin/shared'
import { env } from '../env.js'

export interface AuthTokenClaims {
  sub: string
  login: string
  role: Role
  // Лежит в токене, чтобы /me обходился без БД (вся сессия stateless);
  // токен перевыпускается при правке профиля, чтобы изменение было видно без перелогина.
  firstName: string
  lastName: string
  // Unix-секунды последней смены пароля аккаунта. Передаётся уже сейчас, чтобы будущий
  // механизм отзыва мог отклонять токены, выпущенные до сброса пароля, без миграции
  // формата токена (план авторизации, §3, вариант C).
  pwdChangedAt: number
  // «Запомнить меня», выбранное при входе. Лежит в токене, чтобы скользящее продление
  // (/me) и перевыпуск (смена профиля/пароля) сохраняли время жизни сессии,
  // а не молча понижали долгую сессию до TTL по умолчанию.
  remember: boolean
}

type SignedPayload = AuthTokenClaims & JWTPayload & { exp: number; iat: number }

/** Время жизни сессии в секундах, следующее из выбора «запомнить меня». */
export function ttlForRemember(remember: boolean): number {
  return remember ? env.AUTH_REMEMBER_TTL_SECONDS : env.AUTH_TOKEN_TTL_SECONDS
}

export async function signToken(claims: AuthTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SignedPayload = {
    ...claims,
    iat: now,
    exp: now + ttlForRemember(claims.remember),
  }
  return sign(payload, env.JWT_SECRET, 'HS256')
}

/** Возвращает claims валидного неистёкшего токена; `null` при любой ошибке. */
export async function verifyToken(token: string): Promise<AuthTokenClaims | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256')
    const role = roleSchema.safeParse(payload.role)
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.login !== 'string' ||
      !role.success ||
      typeof payload.pwdChangedAt !== 'number'
    ) {
      return null
    }
    return {
      sub: payload.sub,
      login: payload.login,
      role: role.data,
      // В токенах, выпущенных до появления claims с именем, их нет — подставляем '',
      // чтобы текущая сессия пережила деплой, а не была принудительно разлогинена.
      firstName: typeof payload.firstName === 'string' ? payload.firstName : '',
      lastName: typeof payload.lastName === 'string' ? payload.lastName : '',
      pwdChangedAt: payload.pwdChangedAt,
      // В токенах, выпущенных до появления этого claim, его нет — считаем «не
      // запомнено» (TTL по умолчанию): безопасный короткоживущий вариант.
      remember: payload.remember === true,
    }
  } catch {
    // Истёк / плохая подпись / битый формат — всё сводится к «нет сессии».
    return null
  }
}
