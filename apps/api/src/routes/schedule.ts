import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  SCHEDULE_MAX_RANGE_DAYS,
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  scheduleDayInputSchema,
  scheduleOkSchema,
  scheduleQuerySchema,
  scheduleRangeDays,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { ScheduleError, listSchedule, setScheduleDay } from '../db/schedule.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

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
    'Schedule query failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

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

const listScheduleRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['schedule'],
  request: { query: scheduleQuerySchema },
  responses: {
    200: {
      description: 'Working days of every active master in the range',
      content: { 'application/json': { schema: scheduleOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const setScheduleDayRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['schedule'],
  request: { body: { content: { 'application/json': { schema: scheduleDayInputSchema } } } },
  responses: {
    200: {
      description: 'Day marked as working or off',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    400: respValidation,
    404: {
      description: 'Master not found or archived',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listScheduleRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { from, to } = c.req.valid('query')
    const span = scheduleRangeDays(from, to)
    if (span < 1 || span > SCHEDULE_MAX_RANGE_DAYS) {
      return c.json(
        {
          ok: false as const,
          error: 'validation' as const,
          issues: [{ path: ['to'], message: `Период — от 1 до ${SCHEDULE_MAX_RANGE_DAYS} дней` }],
        },
        StatusCodes.BAD_REQUEST,
      )
    }

    try {
      const schedule = await listSchedule(from, to)
      return c.json({ ok: true as const, from, to, schedule }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'schedule.list.error', requestId, err)
    }
  })
  .openapi(setScheduleDayRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { masterId, date, working } = c.req.valid('json')
    try {
      await setScheduleDay(masterId, date, working)
      baseLogger.info(
        {
          event: 'schedule.day.set',
          request_id: requestId,
          master_id: masterId,
          date,
          working,
          status: 200,
        },
        'Schedule day set',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof ScheduleError) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      return internal(c, 'schedule.day.error', requestId, err)
    }
  })

export default router
