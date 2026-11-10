import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToRow } from '@detailing-admin/shared/sheet-row'
import {
  StatusCodes,
  READINESS,
  bookingMutationOkSchema,
  bookingReadinessInputSchema,
  bookingsListOkSchema,
  dbUnavailableErrorSchema,
  ddmmyyyyToIso,
  formatDdmmyyyy,
  internalErrorSchema,
  notFoundErrorSchema,
  sheetsErrorSchema,
  toCsv,
  unavailableErrorSchema,
  validationErrorSchema,
  canSeeAmounts,
  bookingHistoryOkSchema,
  deletedBookingsOkSchema,
  bookingRestoreConflictSchema,
} from '@detailing-admin/shared'
import type { BookingRow } from '@detailing-admin/shared'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  isDbReady,
} from '../boot.js'
import { appendBooking } from '../sheets.js'
// Кэшируются только успешные результаты (ok: true). См. план, §5.
import * as idempotency from '../idempotency.js'
import { upsertClient } from '../db/clients.js'
import { selectCarId, upsertClientCarReturningId } from '../db/client-cars.js'
import {
  deleteBooking,
  insertBooking,
  listBookingHistory,
  listBookings,
  listDeletedBookings,
  restoreBooking,
  toBookingRow,
  updateBooking,
  updateBookingReadiness,
} from '../db/bookings.js'
import type { AuditActor } from '../db/audit.js'
import type { AuthTokenClaims } from '../auth/jwt.js'
import { notifyMaster } from '../notify.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'
import { EXPORT_CAP, SHOP_TIMEZONE } from '../export.js'

type Vars = { requestId: string }

const idempotencyHeaderSchema = z.object({
  // Свои сообщения сохранены дословно из формулировок старого zValidator.
  // Ключ в схеме в нижнем регистре, потому что HTTP-заголовки регистронезависимы и
  // приходят нормализованными; `bookingsValidationHook` переписывает путь issue обратно
  // в `'Idempotency-Key'`, чтобы wire-формат остался побайтово тем же.
  'idempotency-key': z
    .string({ error: () => 'Required header missing' })
    .min(1, 'Required header missing')
    .max(128, 'Required; max 128 chars'),
})

// Повторяет `notificationResultSchema` из @detailing-admin/shared. Переопределена здесь
// на экземпляре `z` из OpenAPI (в shared — обычный zod), чтобы генерируемая спецификация
// оставалась точной; держи обе синхронными.
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
  // Фильтры по дате приходят в формате UI DD.MM.YYYY; обработчик переводит их в
  // ISO перед запросом. Неверный формат — 400, а не молчаливо проигнорированный фильтр.
  dateFrom: z
    .string()
    .regex(/^\d{2}\.\d{2}\.\d{4}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{2}\.\d{2}\.\d{4}$/)
    .optional(),
  master: z.string().max(120).optional(),
  readiness: z.enum(READINESS).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
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

const historyRoute = createRoute({
  method: 'get',
  path: '/{id}/history',
  tags: ['bookings'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Booking audit history, oldest first',
      content: { 'application/json': { schema: bookingHistoryOkSchema } },
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

const deletedRoute = createRoute({
  method: 'get',
  path: '/deleted',
  tags: ['bookings'],
  responses: {
    200: {
      description: 'Recently deleted bookings',
      content: { 'application/json': { schema: deletedBookingsOkSchema } },
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

const restoreRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['bookings'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Booking restored from its deletion snapshot',
      content: { 'application/json': { schema: bookingMutationOkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: validationErrorSchema } },
    },
    404: {
      description: 'No deletion snapshot for this id',
      content: { 'application/json': { schema: notFoundErrorSchema } },
    },
    409: {
      description: 'Booking already restored',
      content: { 'application/json': { schema: bookingRestoreConflictSchema } },
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

// Корзина показывает последние удаления; старше этого — только через базу.
const DELETED_LIST_LIMIT = 100

function dbUnavailable(c: Context) {
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

function internalError(c: Context, requestId: string, event: string, err: unknown) {
  baseLogger.error(
    {
      event,
      request_id: requestId,
      message: err instanceof Error ? err.message : String(err),
      status: 500,
    },
    'Booking audit request failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

// Кладется в журнал как снимок: имя в аккаунте может поменяться позже.
function auditActor(user: AuthTokenClaims): AuditActor {
  return {
    id: user.sub,
    login: user.login,
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
  }
}

// Хук валидации отвечает за логирование, специфичное для записи, и переписывание путей,
// чтобы и wire-формат, и строка лога на запрос оставались побайтово совместимыми с
// реализацией до OpenAPI.
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
    return c.json(
      { ok: false as const, error: 'validation' as const, issues },
      StatusCodes.BAD_REQUEST,
    )
  }
}

const router = new OpenAPIHono<{ Variables: Vars }>({ defaultHook: bookingsValidationHook })

// Middleware boot-guard. Проставляет request_id, при неудачном init() возвращает 503
// БЕЗ записи в лог (план, §7), иначе передает дальше в openapi-валидацию + обработчик.
// Назначается императивно, потому что `.use()` у OpenAPIHono возвращает обычный `Hono`,
// который в цепочке потерял бы метод `.openapi()`.
router.use('/', async (c, next) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)
  c.set('requestId', requestId)

  // Boot-состояние (проверки заголовков/учетных данных Sheets) закрывает только путь записи.
  // Чтение GET обслуживается из Postgres и от Sheets не зависит — оно защищает
  // себя само через isDbReady().
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
  // Типизирована как обязательная, но голый роутер (gen-openapi, тесты) живет без requireAuth.
  const sessionUser: AuthTokenClaims | undefined = c.get('user')

  // Попадание в кэш идемпотентности — возвращаем закэшированный результат, не трогая Sheets.
  const cached = idempotency.get(idempotencyKey)
  if (cached) {
    if (!cached.ok) {
      // Страховка: в кэше должны лежать только успехи. Удаляем и
      // проваливаемся в новый запрос.
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
          // Повторяем исходный результат уведомления; попадание в кэш не должно
          // повторно слать в Telegram.
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

  // Зеркалим клиента и запись в Postgres (best-effort; Sheets по-прежнему
  // источник истины). Сбои здесь никогда не блокируют запись — на этапе 1 БД
  // чисто дополнительная. Upsert клиента и зеркало записи независимы: если upsert
  // упал, строка записи все равно сохраняется с пустой связью с клиентом (снимок
  // имени/телефона делает строку самодостаточной).
  let clientOutcome: 'inserted' | 'updated' | 'unchanged' | 'skipped' | 'error' = 'skipped'
  let clientId: string | null = null
  let carId: string | null = null
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

    // Best-effort прием машины клиента. Собственный try/catch (рядом с catch'ами
    // upsert и зеркала, НЕ объединенный с ними) — сбой с машиной не должен
    // подавить вставку в зеркало ниже. Пропускается без связанного клиента
    // (не к чему привязать) или при пустой марке/модели.
    if (clientId && booking.car) {
      try {
        // Возвращает id нормализованной строки машины, чтобы зеркало ниже атомарно
        // связало `car_id`; при сбое carId остается null (запись продолжается).
        carId = await upsertClientCarReturningId(clientId, booking.car, booking.plate ?? '')
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
      // Идемпотентно по ключу: повтор после TTL (который снова делает append в Sheets)
      // не создаст вторую строку зеркала.
      bookingPersisted = await insertBooking(booking, {
        idempotencyKey,
        actor: sessionUser ? auditActor(sessionUser) : undefined,
        clientId,
        carId,
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

  // Best-effort уведомление мастеру в Telegram. Выполняется после того, как запись
  // попала в Sheets, и никогда ее не блокирует — сбой лишь понижает ответ до
  // предупреждения, которое показывает форма. Без запроса полностью пропускается.
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
        sort: query.sort,
      })
      // Суммы зависят от роли (в остальном список GET доступен любой
      // авторизованной роли); toBookingRow отбрасывает внутренние id-связи и
      // сериализует метку времени.
      const role = c.get('user')?.role
      const includeAmount = role !== undefined && canSeeAmounts(role)
      const items = rows.map((row) => toBookingRow(row, { includeAmount }))
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
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
      // Заново связываем клиента (телефон мог измениться); best-effort — null при
      // пустом/ненормализуемом телефоне или временном сбое upsert (снимок
      // имени/телефона все равно обновляется).
      let clientId: string | null = null
      try {
        const up = await upsertClient(booking.phone, booking.name)
        clientId = up.client?.id ?? null
      } catch {
        /* оставляем null */
      }
      // Best-effort повторная связь с машиной только на чтение: находит лишь машину, уже
      // лежащую в `client_cars` (без upsert — PATCH не должен копить строки машин). null
      // без клиента, при сбое или ненайденной машине; истиной остается снимок.
      const carId = clientId
        ? await selectCarId(clientId, booking.car, booking.plate ?? '').catch(() => null)
        : null
      const updated = await updateBooking(id, booking, clientId, carId, auditActor(c.get('user')))
      if (!updated) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      // Убираем внутренний ключ идемпотентности и производные id-связи (responsible +
      // car) — ничему из этого не место в wire-ответе.
      const {
        idempotencyKey: _idempotencyKey,
        responsibleId: _responsibleId,
        carId: _carId,
        createdAt,
        ...rest
      } = updated
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
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
      const deleted = await deleteBooking(id, auditActor(c.get('user')))
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
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
      const updated = await updateBookingReadiness(id, readiness, auditActor(c.get('user')))
      if (!updated) {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      // Убираем внутренний ключ идемпотентности и производные id-связи (responsible +
      // car) — ничему из этого не место в wire-ответе.
      const {
        idempotencyKey: _idempotencyKey,
        responsibleId: _responsibleId,
        carId: _carId,
        createdAt,
        ...rest
      } = updated
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
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  },
  defaultValidationHook,
)

router.openapi(deletedRoute, async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)
  if (!isDbReady()) return dbUnavailable(c)
  try {
    const entries = await listDeletedBookings(DELETED_LIST_LIMIT)
    const items = entries.map((e) => ({
      booking: toBookingRow(e.booking, { includeAmount: true }),
      deletedAt: e.deletedAt.toISOString(),
      deletedBy: e.deletedBy,
    }))
    return c.json({ ok: true as const, items }, StatusCodes.OK)
  } catch (err) {
    return internalError(c, requestId, 'bookings.deleted.error', err)
  }
})

router.openapi(
  historyRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return dbUnavailable(c)
    const { id } = c.req.valid('param')
    try {
      const rows = await listBookingHistory(id)
      const items = rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorLogin: r.actorLogin,
        actorName: r.actorName,
        at: r.at.toISOString(),
        changes: r.changes,
      }))
      return c.json({ ok: true as const, items }, StatusCodes.OK)
    } catch (err) {
      return internalError(c, requestId, 'bookings.history.error', err)
    }
  },
  defaultValidationHook,
)

router.openapi(
  restoreRoute,
  async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)
    if (!isDbReady()) return dbUnavailable(c)
    const { id } = c.req.valid('param')
    try {
      const result = await restoreBooking(id, auditActor(c.get('user')))
      if (!result.ok) {
        if (result.reason === 'not_found') {
          return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
        }
        return c.json(
          { ok: false as const, error: 'conflict' as const, reason: 'already_restored' as const },
          StatusCodes.CONFLICT,
        )
      }
      baseLogger.info(
        { event: 'bookings.restore', request_id: requestId, booking_id: id, status: 200 },
        'Booking restored',
      )
      return c.json(
        { ok: true as const, booking: toBookingRow(result.booking, { includeAmount: true }) },
        StatusCodes.OK,
      )
    } catch (err) {
      return internalError(c, requestId, 'bookings.restore.error', err)
    }
  },
  defaultValidationHook,
)

/** ISO `YYYY-MM-DD` → `DD.MM.YYYY` для ячейки отчета. */
function isoDateCell(iso: string): string {
  return formatDdmmyyyy(new Date(iso))
}

/** ISO datetime → `DD.MM.YYYY HH:mm` в часовом поясе студии для столбца «Создано» —
 * совпадает с местным временем сотрудников, а не с сырым UTC. */
function isoDateTimeCell(iso: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: SHOP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

/** Одна CSV-строка из wire-booking. `amount` есть только при `includeAmount`
 * (админ) — набор столбцов должен совпадать с заголовком, собранным с тем же флагом. */
function bookingCsvRow(r: BookingRow, includeAmount: boolean): string[] {
  const date = r.dateTo
    ? `${isoDateCell(r.dateFrom)}-${isoDateCell(r.dateTo)}`
    : isoDateCell(r.dateFrom)
  const time = r.timeTo ? `${r.timeFrom}-${r.timeTo}` : r.timeFrom
  return [
    date,
    time,
    r.name,
    r.phone,
    r.car,
    r.service,
    ...(includeAmount ? [r.amount != null ? String(r.amount) : ''] : []),
    r.readiness,
    r.master.join(', '),
    r.responsible,
    isoDateTimeCell(r.createdAt),
  ]
}

// CSV-экспорт текущей отфильтрованной выборки. Обычный `router.get` (не
// `.openapi()`): CSV — не JSON, поэтому по замыслу он вне `/openapi.json` и
// orval-клиента. Регистрируется отдельным оператором после цепочки, чтобы
// не сужать тип OpenAPIHono. OpenAPI-валидации query здесь нет → схема query
// списка разбирается вручную (400 при плохом фильтре).
router.get('/export', async (c) => {
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
    // Те же ограничения доступа, что у списка GET.
    const role = c.get('user')?.role
    const includeAmount = role !== undefined && canSeeAmounts(role)
    const { items } = await listBookings({
      limit: EXPORT_CAP,
      offset: 0,
      dateFrom: query.dateFrom ? ddmmyyyyToIso(query.dateFrom) : undefined,
      dateTo: query.dateTo ? ddmmyyyyToIso(query.dateTo) : undefined,
      master: query.master,
      readiness: query.readiness,
      q: query.q,
      sort: query.sort,
    })
    const header = [
      'Дата',
      'Время',
      'Имя',
      'Телефон',
      'Авто',
      'Услуга',
      ...(includeAmount ? ['Сумма'] : []),
      'Готовность',
      'Мастера',
      'Ответственный',
      'Создано',
    ]
    const rows = items.map((row) =>
      bookingCsvRow(toBookingRow(row, { includeAmount }), includeAmount),
    )
    const csv = toCsv([header, ...rows], { delimiter: ';', bom: true })

    const truncated = items.length >= EXPORT_CAP
    baseLogger[truncated ? 'warn' : 'info'](
      {
        event: 'bookings.export',
        request_id: requestId,
        count: items.length,
        truncated,
        status: 200,
      },
      truncated ? 'Bookings export truncated at cap' : 'Bookings exported',
    )

    const filename = `bookings-${new Date().toISOString().slice(0, 10)}.csv`
    return c.body(csv, StatusCodes.OK, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  } catch (err) {
    baseLogger.error(
      {
        event: 'bookings.export.error',
        request_id: requestId,
        message: err instanceof Error ? err.message : String(err),
        status: 500,
      },
      'Bookings export failed',
    )
    return c.json(
      { ok: false as const, error: 'internal' as const },
      StatusCodes.INTERNAL_SERVER_ERROR,
    )
  }
})

export default router
