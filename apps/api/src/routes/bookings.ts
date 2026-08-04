import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToRow } from '@detailing-admin/shared/sheet-row'
import {
  StatusCodes,
  bookingMutationOkSchema,
  bookingReadinessInputSchema,
  bookingsListOkSchema,
  dbUnavailableErrorSchema,
  ddmmyyyyToIso,
  internalErrorSchema,
  notFoundErrorSchema,
  sheetsErrorSchema,
  unavailableErrorSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  isDbReady,
} from '../boot.js'
import { appendBooking } from '../sheets.js'
// Only successful (ok: true) results are cached. See plan §5.
import * as idempotency from '../idempotency.js'
import { upsertClient } from '../db/clients.js'
import { upsertClientCar } from '../db/client-cars.js'
import {
  deleteBooking,
  insertBooking,
  listBookings,
  updateBooking,
  updateBookingReadiness,
} from '../db/bookings.js'
import { notifyMaster } from '../notify.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

type Vars = { requestId: string }

const idempotencyHeaderSchema = z.object({
  // Custom messages preserved verbatim from the legacy zValidator wording.
  // The schema key is lowercase because HTTP headers are case-insensitive and
  // arrive normalized; `bookingsValidationHook` rewrites the issue path back to
  // `'Idempotency-Key'` so the wire format stays byte-identical.
  'idempotency-key': z
    .string({ error: () => 'Required header missing' })
    .min(1, 'Required header missing')
    .max(128, 'Required; max 128 chars'),
})

// Mirrors `notificationResultSchema` in @detailing-admin/shared. Redefined here
// against the OpenAPI `z` instance (the shared one is plain zod) so the emitted
// spec stays accurate; keep the two in sync.
const notificationResultSchema = z.object({
  attempted: z.boolean(),
  delivered: z.boolean(),
  reason: z.string().optional(),
})

const bookingSuccessSchema = z.object({
  ok: z.literal(true),
  idempotent: z.boolean(),
  updatedRange: z.string(),
  updatedRow: z.number(),
  notification: notificationResultSchema.optional(),
})

const postBookingRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['bookings'],
  request: {
    headers: idempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: bookingSchema } } },
  },
  responses: {
    201: {
      description: 'Booking created (or replayed from idempotency cache)',
      content: { 'application/json': { schema: bookingSuccessSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    502: {
      description: 'Sheets append failed',
      content: { 'application/json': { schema: sheetsErrorSchema } },
    },
    503: {
      description: 'Boot init blocked (headers mismatch or not configured)',
      content: { 'application/json': { schema: unavailableErrorSchema } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: internalErrorSchema } },
    },
  },
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Date filters arrive in the UI's DD.MM.YYYY format; the handler converts to
  // ISO before querying. Bad shapes 400 rather than silently ignoring a filter.
  dateFrom: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/).optional(),
  dateTo: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/).optional(),
  master: z.string().max(120).optional(),
  readiness: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
})

const getBookingsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['bookings'],
  request: { query: listQuerySchema },
  responses: {
    200: {
      description: 'Bookings list',
      content: { 'application/json': { schema: bookingsListOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
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

const idParamSchema = z.object({
  id: z.string().uuid(),
})

const deleteOkSchema = z.object({ ok: z.literal(true) })

const patchBookingRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['bookings'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: bookingSchema } } },
  },
  responses: {
    200: {
      description: 'Booking updated',
      content: { 'application/json': { schema: bookingMutationOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    404: {
      description: 'Booking not found',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
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

const deleteBookingRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['bookings'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Booking deleted',
      content: { 'application/json': { schema: deleteOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    404: {
      description: 'Booking not found',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
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

const patchReadinessRoute = createRoute({
  method: 'patch',
  path: '/{id}/readiness',
  tags: ['bookings'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: bookingReadinessInputSchema } } },
  },
  responses: {
    200: {
      description: 'Readiness updated',
      content: { 'application/json': { schema: bookingMutationOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    404: {
      description: 'Booking not found',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
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

// Validation hook owns the booking-specific logging plus path rewrites so the
// wire format and the per-request log line both stay byte-compatible with the
// pre-OpenAPI implementation.
function bookingsValidationHook(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context<{ Variables: Vars }>,
) {
  if (!result.success) {
    const requestId = c.get('requestId') ?? uuidv4()
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null
    const issues = result.error.issues.map((i) => ({
      path: i.path.map((p) => {
        if (p === 'idempotency-key') return 'Idempotency-Key'
        if (typeof p === 'symbol') return String(p)
        return p
      }),
      message: i.message,
    }))
    baseLogger.info(
      {
        event: 'booking.request',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        idempotent: false,
        validation_failed: true,
        sheets_latency_ms: null,
        sheets_status_code: null,
        status: 400,
      },
      'Validation failed',
    )
    return c.json({ ok: false as const, error: 'validation' as const, issues }, StatusCodes.BAD_REQUEST)
  }
}

const router = new OpenAPIHono<{ Variables: Vars }>({ defaultHook: bookingsValidationHook })

// Boot guard middleware. Stamps request_id, returns 503 with NO log when
// init() failed (plan §7), otherwise proceeds to openapi validation + handler.
// Assigned imperatively because OpenAPIHono's `.use()` returns a plain `Hono`,
// which would lose the `.openapi()` method on a chained call.
router.use('/', async (c, next) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    c.set('requestId', requestId)

    // Boot state (Sheets header/credential checks) only gates the write path.
    // The GET read serves from Postgres and is independent of Sheets — it guards
    // itself with isDbReady().
    if (c.req.method !== 'POST') {
      await next()
      return
    }

    const state = getBootState()
    if (state === 'ok') {
      await next()
      return
    }

    if (state === 'headers_mismatch') {
      const m = getBootHeadersMismatch()
      return c.json(
        {
          ok: false as const,
          error: 'unavailable' as const,
          reason: 'headers_mismatch' as const,
          column_index: m?.column_index ?? 0,
          expected: m?.expected ?? '',
          observed: m?.observed ?? '',
        },
        StatusCodes.SERVICE_UNAVAILABLE,
      )
    }

    return c.json(
      {
        ok: false as const,
        error: 'unavailable' as const,
        reason: 'not_configured' as const,
        message: getBootNotConfiguredMessage() ?? 'Boot initialization failed',
      },
      StatusCodes.SERVICE_UNAVAILABLE,
    )
  })

router.openapi(postBookingRoute, async (c) => {
    const requestId = c.get('requestId')
    const { 'idempotency-key': idempotencyKey } = c.req.valid('header')

    // Idempotency cache hit — return cached result without touching Sheets.
    const cached = idempotency.get(idempotencyKey)
    if (cached) {
      if (!cached.ok) {
        // Sanity: cache is supposed to hold only successes. Evict and fall
        // through to a fresh request.
        idempotency.delete_(idempotencyKey)
      } else {
        baseLogger.info(
          {
            event: 'booking.request',
            request_id: requestId,
            idempotency_key: idempotencyKey,
            idempotent: true,
            validation_failed: false,
            sheets_latency_ms: null,
            sheets_status_code: null,
            status: 201,
          },
          'Idempotent response served from cache',
        )
        return c.json(
          {
            ok: true as const,
            idempotent: true,
            updatedRange: cached.updatedRange,
            updatedRow: cached.updatedRow,
            // Replay the original notification outcome; a cache hit must not
            // re-send to Telegram.
            ...(cached.notification ? { notification: cached.notification } : {}),
          },
          StatusCodes.CREATED,
        )
      }
    }

    const booking = c.req.valid('json')
    const row = bookingToRow(booking)
    const appendResult = await appendBooking(row)

    if (!appendResult.ok) {
      baseLogger.error(
        {
          event: 'booking.request',
          request_id: requestId,
          idempotency_key: idempotencyKey,
          idempotent: false,
          validation_failed: false,
          sheets_latency_ms: appendResult.latencyMs,
          sheets_status_code: appendResult.statusCode,
          sheets_error_code: appendResult.errorCode,
          status: 502,
        },
        'Sheets append failed',
      )
      return c.json(
        {
          ok: false as const,
          error: 'sheets' as const,
          code: appendResult.statusCode,
          message: appendResult.message,
        },
        StatusCodes.BAD_GATEWAY,
      )
    }

    // Mirror the client and the booking into Postgres (best-effort; Sheets is
    // still the source of truth). Failures here never block the booking — the DB
    // is purely additive at stage 1. The client upsert and the booking mirror are
    // independent: if the upsert fails the booking row is still persisted with a
    // null client link (the snapshot name/phone keep the row self-sufficient).
    let clientOutcome: 'inserted' | 'updated' | 'unchanged' | 'skipped' | 'error' = 'skipped'
    let clientId: string | null = null
    let bookingPersisted = false
    if (isDbReady()) {
      try {
        const result = await upsertClient(booking.phone, booking.name)
        clientOutcome = result.outcome
        clientId = result.client?.id ?? null
      } catch (err) {
        clientOutcome = 'error'
        baseLogger.warn(
          {
            event: 'booking.client_upsert_failed',
            request_id: requestId,
            message: err instanceof Error ? err.message : String(err),
          },
          'Client upsert failed — booking succeeded, DB skipped',
        )
      }

      // Best-effort ingest of the client's car. Own try/catch (sibling to the
      // upsert and mirror catches, NOT combined) — a car failure must not
      // suppress the mirror insert below. Skipped without a linked client
      // (nowhere to attach it) or an empty make/model.
      if (clientId && booking.car) {
        try {
          await upsertClientCar(clientId, booking.car, booking.plate ?? '')
        } catch (err) {
          baseLogger.warn(
            {
              event: 'booking.client_car_upsert_failed',
              request_id: requestId,
              message: err instanceof Error ? err.message : String(err),
            },
            'Client car upsert failed — booking succeeded, DB skipped',
          )
        }
      }

      try {
        // Idempotent on the key: a post-TTL retry (which re-appends to Sheets)
        // will not create a second mirror row.
        bookingPersisted = await insertBooking(booking, {
          idempotencyKey,
          clientId,
          sheetRow: appendResult.updatedRow,
          sheetRange: appendResult.updatedRange,
        })
      } catch (err) {
        baseLogger.warn(
          {
            event: 'booking.db_mirror_failed',
            request_id: requestId,
            message: err instanceof Error ? err.message : String(err),
          },
          'Booking mirror insert failed — booking succeeded, DB skipped',
        )
      }
    }

    // Best-effort Telegram notification to the master. Runs after the write
    // lands in Sheets and never blocks it — a failure only downgrades the
    // response to a warning the form shows. Skipped entirely unless requested.
    const notification = booking.notify ? await notifyMaster(booking) : undefined

    const successResult = {
      ok: true as const,
      idempotent: false,
      updatedRange: appendResult.updatedRange,
      updatedRow: appendResult.updatedRow,
      ...(notification ? { notification } : {}),
    }
    idempotency.set(idempotencyKey, successResult)

    baseLogger.info(
      {
        event: 'booking.request',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        idempotent: false,
        validation_failed: false,
        sheets_latency_ms: appendResult.latencyMs,
        sheets_status_code: appendResult.statusCode,
        client_outcome: clientOutcome,
        booking_persisted: bookingPersisted,
        notification_attempted: notification?.attempted ?? false,
        notification_delivered: notification?.delivered ?? null,
        status: 201,
      },
      'Booking created',
    )

    return c.json(successResult, StatusCodes.CREATED)
  })

router.openapi(
  getBookingsRoute,
  async (c) => {
    const requestId = c.get('requestId')

    if (!isDbReady()) {
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

    const query = c.req.valid('query')
    try {
      const { items: rows, total } = await listBookings({
        limit: query.limit,
        offset: query.offset,
        dateFrom: query.dateFrom ? ddmmyyyyToIso(query.dateFrom) : undefined,
        dateTo: query.dateTo ? ddmmyyyyToIso(query.dateTo) : undefined,
        master: query.master,
        readiness: query.readiness,
        q: query.q,
      })
      // Drop the internal idempotency key, serialize the timestamp, and hide the
      // amount from non-admin roles — amounts are admin-only (the GET list is
      // otherwise available to any authenticated role).
      const isAdmin = c.get('user')?.role === 'admin'
      const items = rows.map(
        ({ idempotencyKey: _idempotencyKey, createdAt, amount, amountFormula, ...rest }) => ({
          ...rest,
          createdAt: createdAt.toISOString(),
          ...(isAdmin ? { amount, amountFormula } : {}),
        }),
      )
      baseLogger.info(
        { event: 'bookings.list', request_id: requestId, count: items.length, total, status: 200 },
        'Bookings listed',
      )
      return c.json({ ok: true as const, items, total }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'bookings.list.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Bookings query failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  },
  defaultValidationHook,
)

router.openapi(
  patchBookingRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) {
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

    const { id } = c.req.valid('param')
    const booking = c.req.valid('json')
    try {
      // Re-link the client (phone may have changed); best-effort — null on an
      // empty/unnormalizable phone or a transient upsert failure (the snapshot
      // name/phone still get updated).
      let clientId: string | null = null
      try {
        const up = await upsertClient(booking.phone, booking.name)
        clientId = up.client?.id ?? null
      } catch {
        /* keep null */
      }
      const updated = await updateBooking(id, booking, clientId)
      if (!updated) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      const { idempotencyKey: _idempotencyKey, createdAt, ...rest } = updated
      baseLogger.info(
        { event: 'bookings.update', request_id: requestId, booking_id: id, status: 200 },
        'Booking updated',
      )
      return c.json(
        { ok: true as const, booking: { ...rest, createdAt: createdAt.toISOString() } },
        StatusCodes.OK,
      )
    } catch (err) {
      baseLogger.error(
        {
          event: 'bookings.update.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Booking update failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  },
  defaultValidationHook,
)

router.openapi(
  deleteBookingRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) {
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

    const { id } = c.req.valid('param')
    try {
      const deleted = await deleteBooking(id)
      if (!deleted) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      baseLogger.info(
        { event: 'bookings.delete', request_id: requestId, booking_id: id, status: 200 },
        'Booking deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'bookings.delete.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Booking delete failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  },
  defaultValidationHook,
)

router.openapi(
  patchReadinessRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) {
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

    const { id } = c.req.valid('param')
    const { readiness } = c.req.valid('json')
    try {
      const updated = await updateBookingReadiness(id, readiness)
      if (!updated) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      const { idempotencyKey: _idempotencyKey, createdAt, ...rest } = updated
      baseLogger.info(
        { event: 'bookings.readiness', request_id: requestId, booking_id: id, status: 200 },
        'Booking readiness updated',
      )
      return c.json(
        { ok: true as const, booking: { ...rest, createdAt: createdAt.toISOString() } },
        StatusCodes.OK,
      )
    } catch (err) {
      baseLogger.error(
        {
          event: 'bookings.readiness.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Booking readiness update failed',
      )
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  },
  defaultValidationHook,
)

export default router
