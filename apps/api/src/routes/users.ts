import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  accountSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { listAccounts } from '../db/users.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

const listOk = z.object({ ok: z.literal(true), accounts: z.array(accountSchema) })

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

const listAccountsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['users'],
  responses: {
    200: { description: 'Login accounts', content: { 'application/json': { schema: listOk } } },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: internalErrorSchema } },
    },
    503: {
      description: 'Database unavailable',
      content: { 'application/json': { schema: dbUnavailableErrorSchema } },
    },
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook }).openapi(
  listAccountsRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    try {
      const accounts = await listAccounts()
      baseLogger.info(
        { event: 'users.list', request_id: requestId, count: accounts.length, status: 200 },
        'Accounts listed',
      )
      return c.json({ ok: true as const, accounts }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'users.list.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Accounts query failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  },
)

export default router
