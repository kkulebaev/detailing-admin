import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  masterWorkRuleSchema,
  notFoundErrorSchema,
  validationErrorSchema,
  workRulesInputSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { WorkRuleError, listWorkRules, replaceMasterWorkRules } from '../db/work-rules.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

const masterIdParamSchema = z.object({
  masterId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const rulesOk = z.object({ ok: z.literal(true), rules: z.array(masterWorkRuleSchema) })

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
    { event, request_id: requestId, message: err instanceof Error ? err.message : String(err) },
    'Work rules request failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}

const listWorkRulesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['salaries'],
  responses: {
    200: {
      description: 'Work rules of every active master',
      content: { 'application/json': { schema: rulesOk } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const replaceWorkRulesRoute = createRoute({
  method: 'put',
  path: '/{masterId}',
  tags: ['salaries'],
  request: {
    params: masterIdParamSchema,
    body: { content: { 'application/json': { schema: workRulesInputSchema } } },
  },
  responses: {
    200: {
      description: 'Work rules replaced',
      content: { 'application/json': { schema: rulesOk } },
    },
    400: {
      description: 'Validation error or an unknown section/service',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    404: {
      description: 'Master not found or archived',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listWorkRulesRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)
    try {
      const rules = await listWorkRules()
      return c.json({ ok: true as const, rules }, StatusCodes.OK)
    } catch (err) {
      return internal(c, 'work_rules.list.error', requestId, err)
    }
  })
  .openapi(replaceWorkRulesRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return unavailable(c)

    const { masterId } = c.req.valid('param')
    const { rules } = c.req.valid('json')
    try {
      const saved = await replaceMasterWorkRules(masterId, rules)
      baseLogger.info(
        {
          event: 'work_rules.replace',
          request_id: requestId,
          master_id: masterId,
          count: saved.length,
          status: 200,
        },
        'Master work rules replaced',
      )
      return c.json({ ok: true as const, rules: saved }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof WorkRuleError && err.code === 'master_not_found') {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      if (err instanceof WorkRuleError && err.code === 'unknown_target') {
        return c.json(
          {
            ok: false as const,
            error: 'validation' as const,
            issues: [{ path: err.path, message: 'Раздела или услуги уже нет в прайсе' }],
          },
          StatusCodes.BAD_REQUEST,
        )
      }
      return internal(c, 'work_rules.replace.error', requestId, err)
    }
  })

export default router
