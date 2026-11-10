import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  masterConflictSchema,
  masterInputSchema,
  masterSchema,
  notFoundErrorSchema,
  reorderInputSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import {
  MasterError,
  createMaster,
  deleteMaster,
  listMasters,
  reorderMasters,
  updateMaster,
} from '../db/masters.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

// Числовой path-параметр — тот же прием «формат, затем преобразование», что в pricelist/clients.
const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const masterInvalidOrderSchema = z.object({
  ok: z.literal(false),
  error: z.literal('validation'),
  reason: z.literal('invalid_order'),
})

const listOk = z.object({ ok: z.literal(true), masters: z.array(masterSchema) })
const mutationOk = z.object({ ok: z.literal(true), master: masterSchema })
const updateOk = z.object({ ok: z.literal(true), master: masterSchema })
const reorderOk = z.object({ ok: z.literal(true), masters: z.array(masterSchema) })
const deleteOk = z.object({ ok: z.literal(true) })

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

// Общий маппер для create/update/delete. `invalid_order` возникает только в
// reorder и превращается в 400 той формы, которую эти маршруты не объявляют, поэтому
// обрабатывается прямо там, а не здесь.
function masterErrorResponse(c: Context, err: unknown) {
  if (err instanceof MasterError) {
    if (err.code === 'not_found') {
      return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
    }
    if (err.code === 'unknown_user') {
      return c.json(
        {
          ok: false as const,
          error: 'validation' as const,
          issues: [{ path: ['userId'], message: 'Аккаунт не найден' }],
        },
        StatusCodes.BAD_REQUEST,
      )
    }
    if (
      err.code === 'duplicate_name' ||
      err.code === 'archived_name' ||
      err.code === 'duplicate_user'
    ) {
      return c.json(
        { ok: false as const, error: 'conflict' as const, reason: err.code },
        StatusCodes.CONFLICT,
      )
    }
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Master mutation failed',
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
const respInvalidOrder = {
  description: 'Invalid reorder set',
  content: { 'application/json': { schema: masterInvalidOrderSchema } },
}
const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}
const respNotFound = {
  description: 'Not found',
  content: { 'application/json': { schema: notFoundErrorSchema } },
}
const respConflict = {
  description: 'Duplicate name, or the account is linked to another master',
  content: { 'application/json': { schema: masterConflictSchema } },
}

const listMastersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['masters'],
  responses: {
    200: { description: 'Masters list', content: { 'application/json': { schema: listOk } } },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createMasterRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['masters'],
  request: { body: { content: { 'application/json': { schema: masterInputSchema } } } },
  responses: {
    201: { description: 'Master created', content: { 'application/json': { schema: mutationOk } } },
    400: respValidation,
    // createMaster никогда не бросает not_found, но в union-типе общего маппера он есть;
    // объявлен, чтобы сигнатура обработчика прошла типчек (как в pricelist).
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

// Объявлен до /{id}, чтобы "reorder" не попал в path-параметр id.
const reorderMastersRoute = createRoute({
  method: 'patch',
  path: '/reorder',
  tags: ['masters'],
  request: { body: { content: { 'application/json': { schema: reorderInputSchema } } } },
  responses: {
    200: {
      description: 'Masters reordered',
      content: { 'application/json': { schema: reorderOk } },
    },
    400: respInvalidOrder,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateMasterRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['masters'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: masterInputSchema } } },
  },
  responses: {
    200: { description: 'Master updated', content: { 'application/json': { schema: updateOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteMasterRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['masters'],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Master deleted', content: { 'application/json': { schema: deleteOk } } },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listMastersRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    try {
      const rows = await listMasters()
      baseLogger.info(
        { event: 'masters.list', request_id: requestId, count: rows.length, status: 200 },
        'Masters listed',
      )
      return c.json({ ok: true as const, masters: rows }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'masters.list.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Masters query failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(createMasterRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const input = c.req.valid('json')
    try {
      const row = await createMaster(input)
      baseLogger.info(
        { event: 'masters.create', request_id: requestId, master_id: row.id, status: 201 },
        'Master created',
      )
      return c.json({ ok: true as const, master: row }, StatusCodes.CREATED)
    } catch (err) {
      return masterErrorResponse(c, err)
    }
  })
  .openapi(reorderMastersRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { ids } = c.req.valid('json')
    try {
      const rows = await reorderMasters(ids)
      baseLogger.info(
        { event: 'masters.reorder', request_id: requestId, count: rows.length, status: 200 },
        'Masters reordered',
      )
      return c.json({ ok: true as const, masters: rows }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof MasterError && err.code === 'invalid_order') {
        return c.json(
          { ok: false as const, error: 'validation' as const, reason: 'invalid_order' as const },
          StatusCodes.BAD_REQUEST,
        )
      }
      baseLogger.error(
        {
          event: 'masters.reorder.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
        },
        'Masters reorder failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(updateMasterRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const input = c.req.valid('json')

    try {
      const master = await updateMaster(id, input)
      baseLogger.info(
        { event: 'masters.update', request_id: requestId, master_id: id, status: 200 },
        'Master updated',
      )
      return c.json({ ok: true as const, master }, StatusCodes.OK)
    } catch (err) {
      return masterErrorResponse(c, err)
    }
  })
  .openapi(deleteMasterRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')

    try {
      await deleteMaster(id)
      baseLogger.info(
        { event: 'masters.delete', request_id: requestId, master_id: id, status: 200 },
        'Master deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      // Обрабатываем на месте: общий маппер расширил бы union кодом 409, который этот
      // маршрут не отдает и не объявляет.
      if (err instanceof MasterError && err.code === 'not_found') {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      baseLogger.error(
        { message: err instanceof Error ? err.message : String(err) },
        'Master delete failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })

export default router
