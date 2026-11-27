import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  myScheduleRequestsOkSchema,
  notFoundErrorSchema,
  scheduleRequestConflictSchema,
  scheduleRequestDatesProblem,
  scheduleRequestInputSchema,
  scheduleRequestRejectedErrorSchema,
  scheduleRequestSchema,
  studioClosedErrorSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { findMasterByUserId } from '../db/masters.js'
import {
  ScheduleRequestError,
  createScheduleRequest,
  listMyScheduleRequests,
  withdrawScheduleRequest,
} from '../db/schedule-requests.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'
import { shopToday } from '../shop-date.js'

// Заявки на свой график: мастер определяется по `sub` сессии, как в «Моих часах»,
// и никогда не берется из тела запроса.

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

const respValidation = {
  description: 'Validation error',
  content: { 'application/json': { schema: validationErrorSchema } },
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

function studioClosed(c: Context, dates: string[]) {
  return c.json(
    { ok: false as const, error: 'validation' as const, reason: 'studio_closed' as const, dates },
    StatusCodes.BAD_REQUEST,
  )
}

function rejected(c: Context, reason: 'not_linked' | 'too_far') {
  return c.json(
    { ok: false as const, error: 'validation' as const, reason },
    StatusCodes.BAD_REQUEST,
  )
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['me'],
  responses: {
    200: {
      description: 'Own recent schedule requests',
      content: { 'application/json': { schema: myScheduleRequestsOkSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const submitRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['me'],
  request: { body: { content: { 'application/json': { schema: scheduleRequestInputSchema } } } },
  responses: {
    201: {
      description: 'Request sent for approval',
      content: {
        'application/json': {
          schema: z.object({ ok: z.literal(true), request: scheduleRequestSchema }),
        },
      },
    },
    400: {
      description:
        'Validation error, account not linked, a date too far ahead, or a working day on a day the studio is closed',
      content: {
        'application/json': {
          schema: z.union([
            validationErrorSchema,
            scheduleRequestRejectedErrorSchema,
            studioClosedErrorSchema,
          ]),
        },
      },
    },
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const withdrawRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['me'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Request withdrawn',
      content: { 'application/json': { schema: actionOk } },
    },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const today = shopToday()
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) {
        return c.json({ ok: true as const, masterId: null, today, requests: [] }, StatusCodes.OK)
      }
      const requests = await listMyScheduleRequests(master.id)
      return c.json({ ok: true as const, masterId: master.id, today, requests }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'me.schedule_requests.list.error', requestId, err)
    }
  })
  .openapi(submitRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { days } = c.req.valid('json')
    const problem = scheduleRequestDatesProblem(
      days.map((d) => d.date),
      shopToday(),
    )
    if (problem) return rejected(c, problem)
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) return rejected(c, 'not_linked')

      const request = await createScheduleRequest(master.id, days, c.get('user').sub)
      baseLogger.info(
        {
          event: 'me.schedule_request.create',
          request_id: requestId,
          master_id: master.id,
          schedule_request_id: request.id,
          days: days.length,
          status: 201,
        },
        'Schedule request sent',
      )
      return c.json({ ok: true as const, request }, StatusCodes.CREATED)
    } catch (err) {
      if (err instanceof ScheduleRequestError) {
        if (err.code === 'pending_exists') return conflict(c, 'pending_exists')
        if (err.code === 'not_found') return rejected(c, 'not_linked')
        if (err.code === 'studio_closed') return studioClosed(c, err.dates)
      }
      return internal(c, 'me.schedule_request.create.error', requestId, err)
    }
  })
  .openapi(withdrawRoute, async (c) => {
    const requestId = crypto.randomUUID()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      // Чужая заявка и отсутствие привязки неотличимы: сотруднику незачем знать чужие id.
      if (!master) return notFound(c)

      await withdrawScheduleRequest(master.id, id)
      baseLogger.info(
        {
          event: 'me.schedule_request.withdraw',
          request_id: requestId,
          master_id: master.id,
          schedule_request_id: id,
          status: 200,
        },
        'Schedule request withdrawn',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof ScheduleRequestError) {
        if (err.code === 'not_found') return notFound(c)
        if (err.code === 'already_decided') return conflict(c, 'already_decided')
      }
      return internal(c, 'me.schedule_request.withdraw.error', requestId, err)
    }
  })

export default router
