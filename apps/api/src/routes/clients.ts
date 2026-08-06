import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  clientDetailOkSchema,
  clientInputSchema,
  clientSchema,
  dbUnavailableErrorSchema,
  formatDdmmyyyy,
  internalErrorSchema,
  joinCar,
  notFoundErrorSchema,
  toCsv,
  validationErrorSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import {
  ClientError,
  createClient,
  deleteClient,
  getClientById,
  getClientStats,
  listClients,
  updateClient,
} from '../db/clients.js'
import { listCarsByClient, listCarsByClientIds } from '../db/client-cars.js'
import { listBookingsByClientId, toBookingRow } from '../db/bookings.js'
import type { Car } from '@detailing-admin/shared'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'
import { EXPORT_CAP } from '../export.js'

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

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().max(200).optional(),
  sort: z.enum(['name', 'phone', 'createdAt']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
})

const listOkResponse = z.object({
  ok: z.literal(true),
  clients: z.array(clientSchema),
  total: z.number().int(),
})
const mutationOkResponse = z.object({ ok: z.literal(true), client: clientSchema })
const deleteOkResponse = z.object({ ok: z.literal(true) })

// The DB row carries `createdAt` as a Date; the wire schema is an ISO string.
// `cars` defaults to [] but every path passes an explicit set: the list path
// the grouped fetch, create/update the reconciled set echoed by the db layer.
function toWireClient(
  row: { id: string; phone: string; name: string; createdAt: Date },
  cars: Car[] = [],
) {
  return { id: row.id, phone: row.phone, name: row.name, createdAt: row.createdAt.toISOString(), cars }
}

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

// Hard cap on the history a card returns; one client's mirror is small in
// practice, so this only guards against an anomaly. Fetch cap+1 to flag truncation.
const CLIENT_HISTORY_CAP = 500

const getClientRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['clients'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Client detail',
      content: { 'application/json': { schema: clientDetailOkSchema } },
    },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const listClientsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['clients'],
  request: { query: listQuerySchema },
  responses: {
    200: { description: 'Clients list', content: { 'application/json': { schema: listOkResponse } } },
    400: respValidation,
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

// Register /export BEFORE the /{id} route below: Hono runs every matching
// handler in registration order, and GET /{id}'s UUID param validation would
// otherwise reject `/export` with a 400 before this handler ran. A separate
// statement (not spliced into the .openapi() chain) keeps the OpenAPIHono type
// intact for the chained links.
router.get('/export', clientsExportHandler)

router
  .openapi(getClientRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    try {
      const client = await getClientById(id)
      if (!client) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      // One client's card: cars, lifetime «Выдана» stats, and the capped history
      // (all statuses) in parallel — no N+1 across the three reads.
      const [cars, stats, historyRows] = await Promise.all([
        listCarsByClient(id),
        getClientStats(id),
        listBookingsByClientId(id, CLIENT_HISTORY_CAP),
      ])
      const bookingsTruncated = historyRows.length > CLIENT_HISTORY_CAP
      const bookings = (
        bookingsTruncated ? historyRows.slice(0, CLIENT_HISTORY_CAP) : historyRows
      ).map((r) => toBookingRow(r, { includeAmount: true }))
      baseLogger.info(
        {
          event: 'clients.detail',
          request_id: requestId,
          client_id: id,
          bookings: bookings.length,
          status: 200,
        },
        'Client detail',
      )
      return c.json(
        { ok: true as const, client: toWireClient(client, cars), stats, bookings, bookingsTruncated },
        StatusCodes.OK,
      )
    } catch (err) {
      baseLogger.error(
        {
          event: 'clients.detail.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Client detail query failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  })
  .openapi(listClientsRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const query = c.req.valid('query')
    try {
      const { items: rows, total } = await listClients({
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        sort: query.sort,
        dir: query.dir,
      })
      // Embed each client's cars in one grouped query (≤ page size ids) to
      // avoid N+1; a client with no cars gets [].
      const carsByClient = await listCarsByClientIds(rows.map((r) => r.id))
      baseLogger.info(
        { event: 'clients.list', request_id: requestId, count: rows.length, total, status: 200 },
        'Clients listed',
      )
      return c.json(
        {
          ok: true as const,
          clients: rows.map((r) => toWireClient(r, carsByClient.get(r.id) ?? [])),
          total,
        },
        StatusCodes.OK,
      )
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

    const { phone, name, cars } = c.req.valid('json')
    try {
      const { client, cars: savedCars } = await createClient(phone, name, cars)
      baseLogger.info(
        { event: 'clients.create', request_id: requestId, client_id: client.id, status: 201 },
        'Client created',
      )
      return c.json(
        { ok: true as const, client: toWireClient(client, savedCars) },
        StatusCodes.CREATED,
      )
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
    const { phone, name, cars } = c.req.valid('json')

    try {
      const { client, cars: savedCars } = await updateClient(id, phone, name, cars)
      baseLogger.info(
        { event: 'clients.update', request_id: requestId, client_id: id, status: 200 },
        'Client updated',
      )
      return c.json({ ok: true as const, client: toWireClient(client, savedCars) }, StatusCodes.OK)
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

// CSV export of the current filtered selection. Plain handler (not `.openapi()`):
// CSV is not JSON → deliberately out of `/openapi.json` and the orval client. The
// `/api/clients/*` admin guard already covers this subpath. Registered above the
// `/{id}` route (see there) so it isn't shadowed. No OpenAPI query validation on a
// plain route → the list query is parsed by hand (400 on a bad filter).
async function clientsExportHandler(c: Context) {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  if (!isDbReady()) return unavailable(c)

  const parsed = listQuerySchema.omit({ limit: true, offset: true }).safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          message: i.message,
        })),
      },
      StatusCodes.BAD_REQUEST,
    )
  }
  const query = parsed.data

  try {
    const { items } = await listClients({
      limit: EXPORT_CAP,
      offset: 0,
      q: query.q,
      sort: query.sort,
      dir: query.dir,
    })
    const carsByClient = await listCarsByClientIds(items.map((r) => r.id))
    const header = ['Имя', 'Телефон', 'Добавлен', 'Машины']
    const rows = items.map((r) => {
      // Multiple cars are joined with ` / `; each car itself is «make, plate».
      const cars = (carsByClient.get(r.id) ?? [])
        .map((car) => joinCar(car.makeModel, car.plate))
        .join(' / ')
      return [r.name, r.phone, formatDdmmyyyy(r.createdAt), cars]
    })
    const csv = toCsv([header, ...rows], { delimiter: ';', bom: true })

    const truncated = items.length >= EXPORT_CAP
    baseLogger[truncated ? 'warn' : 'info'](
      { event: 'clients.export', request_id: requestId, count: items.length, truncated, status: 200 },
      truncated ? 'Clients export truncated at cap' : 'Clients exported',
    )

    const filename = `clients-${new Date().toISOString().slice(0, 10)}.csv`
    return c.body(csv, StatusCodes.OK, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  } catch (err) {
    baseLogger.error(
      {
        event: 'clients.export.error',
        request_id: requestId,
        message: err instanceof Error ? err.message : String(err),
        status: 500,
      },
      'Clients export failed',
    )
    return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
  }
}

export default router
