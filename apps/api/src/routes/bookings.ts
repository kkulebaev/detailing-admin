import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToRow } from '@detailing-admin/shared/sheet-row'
import {
  StatusCodes,
  internalErrorSchema,
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
import { notifyMaster } from '../notify.js'
import { baseLogger } from '../log.js'

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

    // Mirror the client into Postgres (best-effort; Sheets is still source of
    // truth). Failures here never block the booking — DB is purely additive.
    let clientOutcome: 'inserted' | 'updated' | 'unchanged' | 'skipped' | 'error' = 'skipped'
    if (isDbReady()) {
      try {
        const result = await upsertClient(booking.phone, booking.name)
        clientOutcome = result.outcome
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
        notification_attempted: notification?.attempted ?? false,
        notification_delivered: notification?.delivered ?? null,
        status: 201,
      },
      'Booking created',
    )

    return c.json(successResult, StatusCodes.CREATED)
  })

export default router
