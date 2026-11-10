import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  clientDetailOkSchema,
  clientInputSchema,
  clientLookupOkSchema,
  clientLookupQuerySchema,
  clientSchema,
  dbUnavailableErrorSchema,
  formatDdmmyyyy,
  internalErrorSchema,
  joinCar,
  lastDeliveredService,
  missedBookings,
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
  getClientByPhone,
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

// В строке БД `createdAt` — Date, а в wire-схеме — ISO-строка.
// `cars` по умолчанию [], но каждый путь передает явный набор: список — результат
// сгруппированной выборки, create/update — согласованный набор, возвращенный слоем БД.
function toWireClient(
  row: { id: string; phone: string; name: string; createdAt: Date },
  cars: Car[] = [],
) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    cars,
  }
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

// not_found → 404, все остальное → 500. Conflict обрабатывается на каждом месте вызова,
// потому что литерал `reason` у маршрутов разный (duplicate_phone для
// create/update, has_bookings для delete) и каждый маршрут фиксирует один литерал.
function clientErrorFallback(c: Context, err: unknown) {
  if (err instanceof ClientError && err.code === 'not_found') {
    return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Client mutation failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

// Эти константы форм ответов сокращают шаблонный код.
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

// Жесткий лимит истории, которую возвращает карточка; на практике у одного клиента
// записей немного, так что это лишь защита от аномалии. Берем cap+1, чтобы отметить усечение.
const CLIENT_HISTORY_CAP = 500

const lookupClientRoute = createRoute({
  method: 'get',
  path: '/lookup',
  tags: ['clients'],
  request: { query: clientLookupQuerySchema },
  responses: {
    200: {
      description: 'Client matched by exact phone, with a visit summary',
      content: { 'application/json': { schema: clientLookupOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

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
    200: {
      description: 'Clients list',
      content: { 'application/json': { schema: listOkResponse } },
    },
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
    // `clientErrorResponse` формально может вернуть 404 для любой `ClientError`;
    // на практике пути create никогда не бросают not_found, но TS этого не докажет.
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
    200: {
      description: 'Client deleted',
      content: { 'application/json': { schema: deleteOkResponse } },
    },
    400: respValidation,
    404: respNotFound,
    // `deleteClient` бросает `has_bookings`, когда на клиента еще ссылается FK записи;
    // `clientErrorResponse` превращает это в данный вариант 409.
    409: respConflictHasBookings,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })

// /export и /lookup регистрируются ДО маршрута /{id} ниже: Hono запускает все подходящие
// обработчики в порядке регистрации, и валидация UUID-параметра в GET /{id} иначе
// отклонила бы их с 400 раньше, чем сработают эти обработчики. Отдельный оператор
// (не вставленный в цепочку .openapi()) сохраняет тип OpenAPIHono
// для звеньев цепочки.
router.get('/export', clientsExportHandler)

router.openapi(lookupClientRoute, async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  if (!isDbReady()) return unavailable(c)

  const { phone } = c.req.valid('query')
  try {
    const client = await getClientByPhone(phone)
    if (!client) return c.json({ ok: true as const, match: null }, StatusCodes.OK)

    const [cars, stats, historyRows] = await Promise.all([
      listCarsByClient(client.id),
      getClientStats(client.id),
      listBookingsByClientId(client.id, CLIENT_HISTORY_CAP),
    ])
    // Запрос берет на одну строку больше, чтобы отметить усечение для карточки.
    const history = historyRows.slice(0, CLIENT_HISTORY_CAP)
    const isAdmin = c.get('user')?.role === 'admin'
    return c.json(
      {
        ok: true as const,
        match: {
          client: toWireClient(client, cars),
          summary: {
            visitCount: stats.visitCount,
            lastVisit: stats.lastVisit,
            ...(isAdmin ? { totalSpent: stats.totalSpent } : {}),
            lastService: lastDeliveredService(history),
            missed: missedBookings(history),
          },
        },
      },
      StatusCodes.OK,
    )
  } catch (err) {
    baseLogger.error(
      {
        event: 'clients.lookup.error',
        request_id: requestId,
        message: err instanceof Error ? err.message : String(err),
        status: 500,
      },
      'Client lookup failed',
    )
    return c.json(
      { ok: false as const, error: 'internal' as const },
      StatusCodes.INTERNAL_SERVER_ERROR,
    )
  }
})

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
      // Карточка одного клиента: машины, статистика «Выдана» за все время и ограниченная
      // история (все статусы) параллельно — без N+1 на трех чтениях.
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
        {
          ok: true as const,
          client: toWireClient(client, cars),
          stats,
          bookings,
          bookingsTruncated,
        },
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
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
      // Машины каждого клиента подтягиваются одним сгруппированным запросом (≤ размера
      // страницы id), чтобы избежать N+1; клиент без машин получает [].
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
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

// CSV-экспорт текущей отфильтрованной выборки. Обычный обработчик (не `.openapi()`):
// CSV — не JSON → намеренно вне `/openapi.json` и orval-клиента. Админский guard
// `/api/clients/*` уже покрывает этот подпуть. Регистрируется выше маршрута `/{id}`
// (см. там), чтобы тот его не перекрыл. У обычного маршрута нет OpenAPI-валидации query →
// query списка разбирается вручную (400 при плохом фильтре).
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
      // Несколько машин соединяются через ` / `; каждая машина — «марка, госномер».
      const cars = (carsByClient.get(r.id) ?? [])
        .map((car) => joinCar(car.makeModel, car.plate))
        .join(' / ')
      return [r.name, r.phone, formatDdmmyyyy(r.createdAt), cars]
    })
    const csv = toCsv([header, ...rows], { delimiter: ';', bom: true })

    const truncated = items.length >= EXPORT_CAP
    baseLogger[truncated ? 'warn' : 'info'](
      {
        event: 'clients.export',
        request_id: requestId,
        count: items.length,
        truncated,
        status: 200,
      },
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
    return c.json(
      { ok: false as const, error: 'internal' as const },
      StatusCodes.INTERNAL_SERVER_ERROR,
    )
  }
}

export default router
