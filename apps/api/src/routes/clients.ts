import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  clientInputSchema,
  clientSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import {
  ClientError,
  createClient,
  deleteClient,
  listClients,
  updateClient,
} from '../db/clients.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const idParamSchema = z.object({
  id: z.string().regex(UUID_RE),
})

const conflictDuplicatePhoneSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('duplicate_phone'),
})

const conflictHasBookingsSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.literal('has_bookings'),
})

const listOkResponse = z.object({ ok: z.literal(true), clients: z.array(clientSchema) })
const mutationOkResponse = z.object({ ok: z.literal(true), client: clientSchema })
const deleteOkResponse = z.object({ ok: z.literal(true) })

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

// not_found → 404, anything else → 500. Conflict is handled at each call site
// because its `reason` literal differs per route (duplicate_phone for
// create/update, has_bookings for delete) and each route pins a single literal.
function clientErrorFallback(c: Context, err: unknown) {
  if (err instanceof ClientError && err.code === 'not_found') {
    return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Client mutation failed',
  )
  return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
}

// Boilerplate shrunk via these response-shape constants.
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
const respNotFound = {
  description: 'Not found',
  content: { 'application/json': { schema: notFoundErrorSchema } },
}
const respConflictDuplicatePhone = {
  description: 'Duplicate phone',
  content: { 'application/json': { schema: conflictDuplicatePhoneSchema } },
}
const respConflictHasBookings = {
  description: 'Client still referenced by bookings',
  content: { 'application/json': { schema: conflictHasBookingsSchema } },
}

const listClientsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['clients'],
  responses: {
    200: { description: 'Clients list', content: { 'application/json': { schema: listOkResponse } } },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createClientRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['clients'],
  request: {
    body: { content: { 'application/json': { schema: clientInputSchema } } },
  },
  responses: {
    201: {
      description: 'Client created',
      content: { 'application/json': { schema: mutationOkResponse } },
    },
    400: respValidation,
    // `clientErrorResponse` can technically surface 404 for any `ClientError`;
    // create paths never throw not_found in practice but TS can't prove that.
    404: respNotFound,
    409: respConflictDuplicatePhone,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateClientRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['clients'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: clientInputSchema } } },
  },
  responses: {
    200: {
      description: 'Client updated',
      content: { 'application/json': { schema: mutationOkResponse } },
    },
    400: respValidation,
    404: respNotFound,
    409: respConflictDuplicatePhone,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteClientRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['clients'],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Client deleted', content: { 'application/json': { schema: deleteOkResponse } } },
    400: respValidation,
    404: respNotFound,
    // `deleteClient` throws `has_bookings` when a booking FK still references
    // the client; `clientErrorResponse` maps it to this 409 variant.
    409: respConflictHasBookings,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listClientsRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    try {
      const rows = await listClients()
      baseLogger.info(
        { event: 'clients.list', request_id: requestId, count: rows.length, status: 200 },
        'Clients listed',
      )
      return c.json({ ok: true as const, clients: rows }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'clients.list.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Clients query failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  })
  .openapi(createClientRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { phone, name } = c.req.valid('json')
    try {
      const client = await createClient(phone, name)
      baseLogger.info(
        { event: 'clients.create', request_id: requestId, client_id: client.id, status: 201 },
        'Client created',
      )
      return c.json({ ok: true as const, client }, StatusCodes.CREATED)
    } catch (err) {
      if (err instanceof ClientError && err.code === 'duplicate_phone') {
        return c.json(
          { ok: false as const, error: 'conflict' as const, reason: 'duplicate_phone' as const },
          StatusCodes.CONFLICT,
        )
      }
      return clientErrorFallback(c, err)
    }
  })
  .openapi(updateClientRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const { phone, name } = c.req.valid('json')

    try {
      const client = await updateClient(id, phone, name)
      baseLogger.info(
        { event: 'clients.update', request_id: requestId, client_id: id, status: 200 },
        'Client updated',
      )
      return c.json({ ok: true as const, client }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof ClientError && err.code === 'duplicate_phone') {
        return c.json(
          { ok: false as const, error: 'conflict' as const, reason: 'duplicate_phone' as const },
          StatusCodes.CONFLICT,
        )
      }
      return clientErrorFallback(c, err)
    }
  })
  .openapi(deleteClientRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')

    try {
      await deleteClient(id)
      baseLogger.info(
        { event: 'clients.delete', request_id: requestId, client_id: id, status: 200 },
        'Client deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof ClientError && err.code === 'has_bookings') {
        return c.json(
          { ok: false as const, error: 'conflict' as const, reason: 'has_bookings' as const },
          StatusCodes.CONFLICT,
        )
      }
      return clientErrorFallback(c, err)
    }
  })

export default router
