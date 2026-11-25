import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  NOTIFICATIONS_MAX_LIMIT,
  NOTIFICATIONS_PAGE_SIZE,
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  notificationsListOkSchema,
  notificationsUnreadOkSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import type { NotificationRow } from '../db/schema.js'
import { baseLogger } from '../log.js'
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notifications/store.js'
import { defaultValidationHook } from '../openapi.js'

// Лента уведомлений любой роли (guard в server.ts только проверяет сессию). Каждый
// запрос ограничен аккаунтом из сессии: чужие уведомления неотличимы от несуществующих.

function unavailable(c: Context) {
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

function internal(c: Context, event: string, requestId: string, err: unknown) {
  baseLogger.error(
    {
      event,
      request_id: requestId,
      message: err instanceof Error ? err.message : String(err),
      status: 500,
    },
    'Notifications request failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

const positiveInt = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((v) => Number(v))

const listQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATIONS_MAX_LIMIT)
    .default(NOTIFICATIONS_PAGE_SIZE),
  // Курсор: id последнего показанного уведомления.
  before: positiveInt.optional(),
})

const idParamSchema = z.object({ id: positiveInt })

const actionOk = z.object({ ok: z.literal(true) })

const respValidation = {
  description: 'Validation error',
  content: { 'application/json': { schema: validationErrorSchema } },
}
const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}

function toWire(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['notifications'],
  request: { query: listQuerySchema },
  responses: {
    200: {
      description: 'Own notifications, newest first',
      content: { 'application/json': { schema: notificationsListOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const unreadRoute = createRoute({
  method: 'get',
  path: '/unread-count',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'Unread notifications count',
      content: { 'application/json': { schema: notificationsUnreadOkSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const readAllRoute = createRoute({
  method: 'post',
  path: '/read-all',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'All own notifications read',
      content: { 'application/json': { schema: actionOk } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const readRoute = createRoute({
  method: 'post',
  path: '/{id}/read',
  tags: ['notifications'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Notification read',
      content: { 'application/json': { schema: actionOk } },
    },
    400: respValidation,
    404: {
      description: 'Notification not found',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

// Статический /read-all регистрируется до /{id}/read, чтобы валидатор id его не перехватил.
const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)

    const { limit, before } = c.req.valid('query')
    const userId = c.get('user').sub
    try {
      const [rows, unreadCount] = await Promise.all([
        listNotifications(userId, { limit, before }),
        countUnreadNotifications(userId),
      ])
      return c.json(
        {
          ok: true as const,
          items: rows.slice(0, limit).map(toWire),
          hasMore: rows.length > limit,
          unreadCount,
        },
        StatusCodes.OK,
      )
    } catch (err) {
      return internal(c, 'notifications.list.error', requestId, err)
    }
  })
  .openapi(unreadRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    try {
      const unreadCount = await countUnreadNotifications(c.get('user').sub)
      return c.json({ ok: true as const, unreadCount }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.unread.error', requestId, err)
    }
  })
  .openapi(readAllRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    try {
      await markAllNotificationsRead(c.get('user').sub)
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.read_all.error', requestId, err)
    }
  })
  .openapi(readRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const { id } = c.req.valid('param')
    try {
      const found = await markNotificationRead(c.get('user').sub, id)
      if (!found) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.read.error', requestId, err)
    }
  })

export default router
