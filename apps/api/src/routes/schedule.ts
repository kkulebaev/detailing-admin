import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  SCHEDULE_MAX_RANGE_DAYS,
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  scheduleOkSchema,
  scheduleQuerySchema,
  scheduleRangeDays,
  scheduleUpdateInputSchema,
  studioHoursInputSchema,
  studioHoursOkSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { ScheduleError, listSchedule, setScheduleDays } from '../db/schedule.js'
import { getStudioHours, setStudioHours } from '../db/studio-hours.js'
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

const setScheduleDaysRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['schedule'],
  request: { body: { content: { 'application/json': { schema: scheduleUpdateInputSchema } } } },
  responses: {
    200: {
      description: 'Days marked as working or off, all in one transaction',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    400: respValidation,
    404: {
      description: 'A master not found or archived; nothing saved',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const getStudioHoursRoute = createRoute({
  method: 'get',
  path: '/studio-hours',
  tags: ['schedule'],
  responses: {
    200: {
      description: 'Studio working days of the week with opening hours; empty when not set',
      content: { 'application/json': { schema: studioHoursOkSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const setStudioHoursRoute = createRoute({
  method: 'put',
  path: '/studio-hours',
  tags: ['schedule'],
  request: { body: { content: { 'application/json': { schema: studioHoursInputSchema } } } },
  responses: {
    200: {
      description: 'Studio hours replaced as a whole',
      content: { 'application/json': { schema: studioHoursOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(getStudioHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    try {
      return c.json({ ok: true as const, days: await getStudioHours() }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'studio_hours.get.error', requestId, err)
    }
  })
  .openapi(setStudioHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { days } = c.req.valid('json')
    try {
      await setStudioHours(days)
      baseLogger.info(
        { event: 'studio_hours.set', request_id: requestId, count: days.length, status: 200 },
        'Studio hours set',
      )
      const sorted = [...days].sort((a, b) => a.weekday - b.weekday)
      return c.json({ ok: true as const, days: sorted }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'studio_hours.set.error', requestId, err)
    }
  })
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
  .openapi(setScheduleDaysRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { days } = c.req.valid('json')
    try {
      await setScheduleDays(days)
      baseLogger.info(
        { event: 'schedule.days.set', request_id: requestId, count: days.length, status: 200 },
        'Schedule days set',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof ScheduleError) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      return internal(c, 'schedule.days.error', requestId, err)
    }
  })

export default router
