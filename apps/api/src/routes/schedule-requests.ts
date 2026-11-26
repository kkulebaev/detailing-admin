import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  scheduleRequestConflictSchema,
  scheduleRequestRejectInputSchema,
  scheduleRequestsOkSchema,
  studioClosedErrorSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import type { AuthTokenClaims } from '../auth/jwt.js'
import { isDbReady } from '../boot.js'
import type { AuditActor } from '../db/audit.js'
import {
  ScheduleRequestError,
  decideScheduleRequest,
  listPendingScheduleRequests,
} from '../db/schedule-requests.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

// Согласование заявок на график. Только для админа (guard в server.ts); решить
// заявку может любой админ, первый ответивший.

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
    'Schedule request failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

function studioClosed(c: Context, dates: string[]) {
  return c.json(
    { ok: false as const, error: 'validation' as const, reason: 'studio_closed' as const, dates },
    StatusCodes.BAD_REQUEST,
  )
}

function notFound(c: Context) {
  return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
}

function conflict(c: Context, reason: 'pending_exists' | 'already_decided') {
  return c.json({ ok: false as const, error: 'conflict' as const, reason }, StatusCodes.CONFLICT)
}

const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const actionOk = z.object({ ok: z.literal(true) })

// Общий для одобрения и отказа: оба идут через decide(), а одобрение может
// упереться в выходной студии.
const respDecideValidation = {
  description:
    'Validation error, or the request asks for a working day on a day the studio is closed',
  content: {
    'application/json': { schema: z.union([validationErrorSchema, studioClosedErrorSchema]) },
  },
}
const respNotFound = {
  description: 'Request not found',
  content: { 'application/json': { schema: notFoundErrorSchema } },
}
const respConflict = {
  description: 'A pending request already exists, or the request is already decided',
  content: { 'application/json': { schema: scheduleRequestConflictSchema } },
}
const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}

function actorOf(user: AuthTokenClaims): AuditActor {
  return {
    id: user.sub,
    login: user.login,
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['schedule-requests'],
  responses: {
    200: {
      description: 'Pending requests of active masters, oldest first',
      content: { 'application/json': { schema: scheduleRequestsOkSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const approveRoute = createRoute({
  method: 'post',
  path: '/{id}/approve',
  tags: ['schedule-requests'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Request approved and applied to the schedule',
      content: { 'application/json': { schema: actionOk } },
    },
    400: respDecideValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const rejectRoute = createRoute({
  method: 'post',
  path: '/{id}/reject',
  tags: ['schedule-requests'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: scheduleRequestRejectInputSchema } } },
  },
  responses: {
    200: { description: 'Request rejected', content: { 'application/json': { schema: actionOk } } },
    400: respDecideValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

async function decide(
  c: Context,
  id: number,
  decision: { approve: true } | { approve: false; comment: string | null },
) {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)
  try {
    await decideScheduleRequest(id, actorOf(c.get('user')), decision)
    baseLogger.info(
      {
        event: decision.approve ? 'schedule_request.approve' : 'schedule_request.reject',
        request_id: requestId,
        schedule_request_id: id,
        status: 200,
      },
      'Schedule request decided',
    )
    return c.json({ ok: true as const }, StatusCodes.OK)
  } catch (err) {
    if (err instanceof ScheduleRequestError) {
      if (err.code === 'not_found') return notFound(c)
      if (err.code === 'already_decided') return conflict(c, 'already_decided')
      if (err.code === 'studio_closed') return studioClosed(c, err.dates)
    }
    return internal(c, 'schedule_request.decide.error', requestId, err)
  }
}

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    try {
      const requests = await listPendingScheduleRequests()
      return c.json({ ok: true as const, requests }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'schedule_requests.list.error', requestId, err)
    }
  })
  .openapi(approveRoute, async (c) => {
    if (!isDbReady()) return unavailable(c)
    return decide(c, c.req.valid('param').id, { approve: true })
  })
  .openapi(rejectRoute, async (c) => {
    if (!isDbReady()) return unavailable(c)
    const { comment } = c.req.valid('json')
    return decide(c, c.req.valid('param').id, { approve: false, comment: comment || null })
  })

export default router
