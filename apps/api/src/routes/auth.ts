import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  changePasswordRequestSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  loginRequestSchema,
  stalePasswordConflictSchema,
  toRole,
  unauthorizedErrorSchema,
  updateProfileRequestSchema,
  userPublicSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { findByLogin, updatePasswordHash, updateProfile } from '../db/users.js'
import { dummyVerify, hashPassword, verifyPassword } from '../auth/password.js'
import { signToken, verifyToken, ttlForRemember } from '../auth/jwt.js'
import { setAuthCookie, clearAuthCookie, getAuthToken } from '../auth/cookie.js'
import { requireAuth } from '../auth/middleware.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

const userOk = z.object({ ok: z.literal(true), user: userPublicSchema })
const okOnly = z.object({ ok: z.literal(true) })

const respValidation = {
  description: 'Validation error',
  content: { 'application/json': { schema: validationErrorSchema } },
}
const respUnauthorized = {
  description: 'Invalid credentials or no session',
  content: { 'application/json': { schema: unauthorizedErrorSchema } },
}
const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}

function dbUnavailable(c: Context) {
  return c.json(
    {
      ok: false as const,
      error: 'unavailable' as const,
      reason: 'not_configured' as const,
      message: 'Database not configured or migrations failed',
    },
    StatusCodes.SERVICE_UNAVAILABLE,
  )
}

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
  responses: {
    200: { description: 'Logged in', content: { 'application/json': { schema: userOk } } },
    400: respValidation,
    401: respUnauthorized,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['auth'],
  responses: {
    200: { description: 'Logged out', content: { 'application/json': { schema: okOnly } } },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['auth'],
  responses: {
    200: { description: 'Current session', content: { 'application/json': { schema: userOk } } },
    401: respUnauthorized,
  },
})

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: changePasswordRequestSchema } } },
  },
  responses: {
    200: { description: 'Password changed', content: { 'application/json': { schema: okOnly } } },
    400: respValidation,
    401: respUnauthorized,
    409: {
      description: 'Lost a concurrent change-password race',
      content: { 'application/json': { schema: stalePasswordConflictSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: updateProfileRequestSchema } } },
  },
  responses: {
    200: { description: 'Profile updated', content: { 'application/json': { schema: userOk } } },
    400: respValidation,
    401: respUnauthorized,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })

// Ответы авторизации нельзя кэшировать (устаревший /me может раскрыть прежнюю сессию).
router.use('/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

// Сессия нужна только для change-password. Регистрируется до цепочки openapi, чтобы
// обернуть этот обработчик; `.use()` посреди цепочки `.openapi()` расширил бы тип до
// обычного Hono и потерял `.openapi()` (по той же причине server.ts собирается императивно).
router.use('/change-password', requireAuth)
// PATCH /me (правка профиля) требует сессию; GET /me остаётся публичным (сам читает
// cookie). Проверка метода ограничивает это PATCH, чтобы геттер не затрагивался.
router.use('/me', async (c, next) => {
  if (c.req.method !== 'PATCH') return next()
  return requireAuth(c, next)
})

router
  .openapi(loginRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return dbUnavailable(c)

    const { login, password, remember } = c.req.valid('json')
    const user = await findByLogin(login)

    if (!user) {
      // Ветка постоянного времени: никогда не раскрываем, существует ли логин.
      await dummyVerify(password)
      baseLogger.info(
        {
          event: 'auth.login.fail',
          request_id: requestId,
          login,
          reason: 'unknown_login',
          status: 401,
        },
        'Login failed',
      )
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      baseLogger.info(
        {
          event: 'auth.login.fail',
          request_id: requestId,
          login,
          reason: 'bad_password',
          status: 401,
        },
        'Login failed',
      )
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }

    const role = toRole(user.role)
    const token = await signToken({
      sub: user.id,
      login: user.login,
      role,
      firstName: user.firstName,
      lastName: user.lastName,
      pwdChangedAt: Math.floor(user.passwordChangedAt.getTime() / 1000),
      remember: remember ?? false,
    })
    setAuthCookie(c, token, ttlForRemember(remember ?? false))

    baseLogger.info(
      { event: 'auth.login.ok', request_id: requestId, login, role, status: 200 },
      'Login ok',
    )
    return c.json(
      {
        ok: true as const,
        user: { login: user.login, role, firstName: user.firstName, lastName: user.lastName },
      },
      StatusCodes.OK,
    )
  })
  .openapi(logoutRoute, async (c) => {
    // Stateless: на сервере можно только очистить cookie. Идемпотентно —
    // сессия не нужна, БД не трогается.
    clearAuthCookie(c)
    return c.json({ ok: true as const }, StatusCodes.OK)
  })
  .openapi(meRoute, async (c) => {
    const token = getAuthToken(c)
    if (!token) {
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }
    const claims = await verifyToken(token)
    if (!claims) {
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }
    // Скользящее продление: перевыпускаем токен со свежим exp, чтобы активная сессия
    // не истекла посреди работы. Без чтения из БД — только туда-обратно с токеном.
    const token2 = await signToken({
      sub: claims.sub,
      login: claims.login,
      role: claims.role,
      firstName: claims.firstName,
      lastName: claims.lastName,
      pwdChangedAt: claims.pwdChangedAt,
      remember: claims.remember,
    })
    setAuthCookie(c, token2, ttlForRemember(claims.remember))
    return c.json(
      {
        ok: true as const,
        user: {
          login: claims.login,
          role: claims.role,
          firstName: claims.firstName,
          lastName: claims.lastName,
        },
      },
      StatusCodes.OK,
    )
  })
  .openapi(changePasswordRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return dbUnavailable(c)

    const user = c.get('user')
    const { currentPassword, newPassword } = c.req.valid('json')

    const current = await findByLogin(user.login)
    if (!current) {
      // Сессия валидна, но аккаунт исчез (удалён между входом и текущим моментом).
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }

    const valid = await verifyPassword(currentPassword, current.passwordHash)
    if (!valid) {
      return c.json(
        {
          ok: false as const,
          error: 'validation' as const,
          issues: [{ path: ['currentPassword'], message: 'Неверный текущий пароль' }],
        },
        StatusCodes.BAD_REQUEST,
      )
    }

    const newHash = await hashPassword(newPassword)
    const updated = await updatePasswordHash(current.id, newHash, current.passwordHash)
    if (!updated) {
      // Параллельный change-password выиграл условный UPDATE; наши данные
      // устарели — не сообщаем о ложном успехе.
      return c.json(
        { ok: false as const, error: 'conflict' as const, reason: 'stale_password' as const },
        StatusCodes.CONFLICT,
      )
    }

    // Перевыпускаем cookie этой сессии с новым pwdChangedAt, чтобы вызывающий не
    // разлогинил сам себя при будущей проверке отзыва (вариант C отклоняет
    // токены, выпущенные до последней смены пароля аккаунта).
    const refreshed = await signToken({
      sub: current.id,
      login: current.login,
      role: user.role,
      firstName: current.firstName,
      lastName: current.lastName,
      pwdChangedAt: Math.floor(Date.now() / 1000),
      remember: user.remember,
    })
    setAuthCookie(c, refreshed, ttlForRemember(user.remember))

    baseLogger.info(
      { event: 'auth.change_password.ok', request_id: requestId, login: user.login, status: 200 },
      'Password changed',
    )
    return c.json({ ok: true as const }, StatusCodes.OK)
  })
  .openapi(updateProfileRoute, async (c) => {
    if (!isDbReady()) return dbUnavailable(c)

    const user = c.get('user')
    const { firstName, lastName } = c.req.valid('json')

    const updated = await updateProfile(user.sub, { firstName, lastName })
    if (!updated) {
      // Сессия валидна, но аккаунт исчез (удалён между входом и текущим моментом).
      return c.json(
        { ok: false as const, error: 'unauthorized' as const },
        StatusCodes.UNAUTHORIZED,
      )
    }

    // Перевыпускаем, чтобы cookie (а значит, и /me без БД) сразу несла новое имя —
    // перелогин не нужен. Семантику pwdChangedAt/exp сохраняем.
    const refreshed = await signToken({
      sub: updated.id,
      login: updated.login,
      role: user.role,
      firstName: updated.firstName,
      lastName: updated.lastName,
      pwdChangedAt: user.pwdChangedAt,
      remember: user.remember,
    })
    setAuthCookie(c, refreshed, ttlForRemember(user.remember))

    return c.json(
      {
        ok: true as const,
        user: {
          login: updated.login,
          role: user.role,
          firstName: updated.firstName,
          lastName: updated.lastName,
        },
      },
      StatusCodes.OK,
    )
  })

export default router
