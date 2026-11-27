import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import {
  NOTIFICATIONS_MAX_LIMIT,
  NOTIFICATIONS_PAGE_SIZE,
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  notificationsListOkSchema,
  notificationsUnreadOkSchema,
  pushConfigOkSchema,
  pushEndpointInputSchema,
  pushSubscriptionInputSchema,
  pushSubscriptionStatusOkSchema,
  telegramBotUnavailableErrorSchema,
  telegramLinkOkSchema,
  telegramStatusOkSchema,
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
  markNotificationUnread,
} from '../notifications/store.js'
import {
  deletePushSubscription,
  hasPushSubscription,
  upsertPushSubscription,
} from '../notifications/push-subscriptions.js'
import { pushPublicKey } from '../notifications/web-push.js'
import {
  createLinkToken,
  isTelegramConnected,
  unlinkTelegram,
} from '../notifications/telegram-link.js'
import { getBotUsername } from '../notifications/telegram-poller.js'
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

const unreadMarkRoute = createRoute({
  method: 'post',
  path: '/{id}/unread',
  tags: ['notifications'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Notification marked unread',
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

const pushConfigRoute = createRoute({
  method: 'get',
  path: '/push/config',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'VAPID public key, null when push is not configured',
      content: { 'application/json': { schema: pushConfigOkSchema } },
    },
  },
})

const pushSubscribeRoute = createRoute({
  method: 'post',
  path: '/push/subscriptions',
  tags: ['notifications'],
  request: {
    body: { content: { 'application/json': { schema: pushSubscriptionInputSchema } } },
  },
  responses: {
    200: {
      description: 'Subscription saved for the current account',
      content: { 'application/json': { schema: actionOk } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const pushUnsubscribeRoute = createRoute({
  method: 'delete',
  path: '/push/subscriptions',
  tags: ['notifications'],
  request: {
    body: { content: { 'application/json': { schema: pushEndpointInputSchema } } },
  },
  responses: {
    200: {
      description: 'Own subscription removed (no-op when absent)',
      content: { 'application/json': { schema: actionOk } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

// POST с телом, а не GET с query: endpoint — по сути секрет подписки, а query оседает
// в access-логах прокси.
const pushCurrentRoute = createRoute({
  method: 'post',
  path: '/push/subscriptions/current',
  tags: ['notifications'],
  request: {
    body: { content: { 'application/json': { schema: pushEndpointInputSchema } } },
  },
  responses: {
    200: {
      description: 'Whether this endpoint is subscribed for the current account',
      content: { 'application/json': { schema: pushSubscriptionStatusOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const telegramStatusRoute = createRoute({
  method: 'get',
  path: '/telegram',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'Whether Telegram is linked to the current account',
      content: { 'application/json': { schema: telegramStatusOkSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const telegramLinkRoute = createRoute({
  method: 'post',
  path: '/telegram/link',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'One-time deep link to the bot',
      content: { 'application/json': { schema: telegramLinkOkSchema } },
    },
    500: respInternal,
    503: {
      description: 'Database or bot unavailable',
      content: {
        'application/json': {
          schema: z.union([dbUnavailableErrorSchema, telegramBotUnavailableErrorSchema]),
        },
      },
    },
  },
})

const telegramUnlinkRoute = createRoute({
  method: 'delete',
  path: '/telegram',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'Telegram unlinked (no-op when not linked)',
      content: { 'application/json': { schema: actionOk } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const USER_AGENT_MAX = 512

// Статические пути (/read-all, /push/*) регистрируются до /{id}/read и /{id}/unread, чтобы валидатор id
// их не перехватил.
const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  // Ключ отдается и без базы: он из env, а без него страница профиля прячет переключатель.
  .openapi(pushConfigRoute, (c) =>
    c.json({ ok: true as const, publicKey: pushPublicKey() }, StatusCodes.OK),
  )
  .openapi(pushSubscribeRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const { endpoint, keys } = c.req.valid('json')
    const user = c.get('user')
    try {
      await upsertPushSubscription(user.sub, {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: c.req.header('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
        // Строка живет не дольше сохранившей ее сессии: телефон, вышедший по сроку, не
        // получает пуши аккаунта. Web пересохраняет подписку при входе и каждом старте
        // приложения, а /me перевыпускает токен, так что срок скользит вместе с сессией.
        expiresAt: new Date(user.exp * 1000),
      })
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.push.subscribe.error', requestId, err)
    }
  })
  .openapi(pushUnsubscribeRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const { endpoint } = c.req.valid('json')
    try {
      await deletePushSubscription(c.get('user').sub, endpoint)
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.push.unsubscribe.error', requestId, err)
    }
  })
  .openapi(pushCurrentRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const { endpoint } = c.req.valid('json')
    try {
      const subscribed = await hasPushSubscription(c.get('user').sub, endpoint)
      return c.json({ ok: true as const, subscribed }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.push.current.error', requestId, err)
    }
  })
  .openapi(telegramStatusRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    try {
      const connected = await isTelegramConnected(c.get('user').sub)
      return c.json(
        { ok: true as const, connected, botAvailable: getBotUsername() !== null },
        StatusCodes.OK,
      )
    } catch (err) {
      return internal(c, 'notifications.telegram.status.error', requestId, err)
    }
  })
  .openapi(telegramLinkRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const username = getBotUsername()
    if (username === null) {
      return c.json(
        { ok: false as const, error: 'bot_unavailable' as const },
        StatusCodes.SERVICE_UNAVAILABLE,
      )
    }
    try {
      const token = await createLinkToken(c.get('user').sub)
      return c.json(
        { ok: true as const, url: `https://t.me/${username}?start=${token}` },
        StatusCodes.OK,
      )
    } catch (err) {
      return internal(c, 'notifications.telegram.link.error', requestId, err)
    }
  })
  .openapi(telegramUnlinkRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    try {
      await unlinkTelegram(c.get('user').sub)
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.telegram.unlink.error', requestId, err)
    }
  })
  .openapi(listRoute, async (c) => {
    const requestId = crypto.randomUUID()
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
    const requestId = crypto.randomUUID()
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
    const requestId = crypto.randomUUID()
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
    const requestId = crypto.randomUUID()
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
  .openapi(unreadMarkRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    const { id } = c.req.valid('param')
    try {
      const found = await markNotificationUnread(c.get('user').sub, id)
      if (!found) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'notifications.unread_mark.error', requestId, err)
    }
  })

export default router
