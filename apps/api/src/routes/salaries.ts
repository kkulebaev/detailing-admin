import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  hoursToMinutes,
  internalErrorSchema,
  mergeSalaryEntries,
  monthSchema,
  notFoundErrorSchema,
  payoutInputSchema,
  payoutSchema,
  payoutUpdateSchema,
  rateInputSchema,
  salaryEntrySchema,
  salaryRowSchema,
  validationErrorSchema,
  workHoursInputSchema,
  workHoursNoRateSchema,
  workHoursSchema,
  workHoursUpdateSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import {
  SalaryError,
  createPayout,
  createWorkHours,
  deletePayout,
  deleteWorkHours,
  listMasterEntries,
  listSalaries,
  setMasterRate,
  updatePayout,
  updateWorkHours,
  type PayoutPatch,
  type WorkHoursPatch,
} from '../db/salaries.js'
import type { PayoutRow, WorkHoursRow } from '../db/schema.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

// Числовой path-параметр — тот же прием «формат, затем преобразование», что и в других маршрутах.
const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const monthQuerySchema = z.object({ month: monthSchema })
const entriesQuerySchema = z.object({
  masterId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
  month: monthSchema,
})

const salariesListOk = z.object({
  ok: z.literal(true),
  month: z.string(),
  rows: z.array(salaryRowSchema),
})
const salaryEntriesListOk = z.object({ ok: z.literal(true), entries: z.array(salaryEntrySchema) })
const rateMutationOk = z.object({ ok: z.literal(true) })
const workHoursMutationOk = z.object({ ok: z.literal(true), hours: workHoursSchema })
const payoutMutationOk = z.object({ ok: z.literal(true), payout: payoutSchema })
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

// not_found → 404, все остальное → 500. Доменные конфликты
// (no_rate в POST /hours, master_not_found в PATCH /rates) задают свой статус
// в каждом маршруте и обрабатываются прямо на месте вызова.
function salaryErrorFallback(c: Context, err: unknown) {
  if (err instanceof SalaryError && err.code === 'not_found') {
    return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Salary mutation failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

// not_found → 404; все остальное неожиданно → 500. Отдельно от
// salaryErrorFallback, чтобы события выплат несли payout_id и собственный тег.
// Сумма и примечание никогда не логируются.
function payoutErrorFallback(
  c: Context,
  err: unknown,
  event: string,
  requestId: string,
  payoutId: number,
) {
  if (err instanceof SalaryError && err.code === 'not_found') {
    return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
  }
  baseLogger.error(
    {
      event,
      request_id: requestId,
      payout_id: payoutId,
      message: err instanceof Error ? err.message : String(err),
      status: 500,
    },
    'Payout mutation failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

// createdAt приходит из Drizzle как Date; для ответа сериализуем в ISO-строку
// (workDate уже строка YYYY-MM-DD).
function toWire(row: WorkHoursRow) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

// Та же сериализация для выплат в ленте (payoutDate — строка).
function payoutToWire(row: PayoutRow) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

const respValidation = {
  description: 'Validation error',
  content: { 'application/json': { schema: validationErrorSchema } },
}
const respNoRate = {
  description: 'Master has no rate set',
  content: { 'application/json': { schema: workHoursNoRateSchema } },
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

const listSalariesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['salaries'],
  request: { query: monthQuerySchema },
  responses: {
    200: {
      description: 'Salaries for the month',
      content: { 'application/json': { schema: salariesListOk } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

// Объявлен до /hours/{id} и т. п.; отдельный статический путь, так что перехвата не будет.
const setRateRoute = createRoute({
  method: 'patch',
  path: '/rates',
  tags: ['salaries'],
  request: { body: { content: { 'application/json': { schema: rateInputSchema } } } },
  responses: {
    200: { description: 'Rate set', content: { 'application/json': { schema: rateMutationOk } } },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

// Одна лента на мастера/месяц: часы и выплаты уже объединены и отсортированы, поэтому
// раскрытая строка стоит одного запроса и имеет одно состояние загрузки.
const listEntriesRoute = createRoute({
  method: 'get',
  path: '/entries',
  tags: ['salaries'],
  request: { query: entriesQuerySchema },
  responses: {
    200: {
      description: 'Salary entries for a master/month',
      content: { 'application/json': { schema: salaryEntriesListOk } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createWorkHoursRoute = createRoute({
  method: 'post',
  path: '/hours',
  tags: ['salaries'],
  request: { body: { content: { 'application/json': { schema: workHoursInputSchema } } } },
  responses: {
    201: {
      description: 'Work hours added',
      content: { 'application/json': { schema: workHoursMutationOk } },
    },
    // Собственный 400 обработчика — это предусловие no_rate. Ошибка zod-валидации тела
    // тоже дает 400 (через defaultHook) в форме validation — то же соглашение
    // «один статус / одна схема», что в reorder у masters (invalid_order).
    400: respNoRate,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateWorkHoursRoute = createRoute({
  method: 'patch',
  path: '/hours/{id}',
  tags: ['salaries'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: workHoursUpdateSchema } } },
  },
  responses: {
    200: {
      description: 'Work hours updated',
      content: { 'application/json': { schema: workHoursMutationOk } },
    },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteWorkHoursRoute = createRoute({
  method: 'delete',
  path: '/hours/{id}',
  tags: ['salaries'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Work hours deleted',
      content: { 'application/json': { schema: deleteOk } },
    },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

// 404 здесь означает неизвестного мастера — выплате ставка не нужна, поэтому
// предусловия no_rate нет (в отличие от POST /hours).
const createPayoutRoute = createRoute({
  method: 'post',
  path: '/payouts',
  tags: ['salaries'],
  request: { body: { content: { 'application/json': { schema: payoutInputSchema } } } },
  responses: {
    201: {
      description: 'Payout added',
      content: { 'application/json': { schema: payoutMutationOk } },
    },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updatePayoutRoute = createRoute({
  method: 'patch',
  path: '/payouts/{id}',
  tags: ['salaries'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: payoutUpdateSchema } } },
  },
  responses: {
    200: {
      description: 'Payout updated',
      content: { 'application/json': { schema: payoutMutationOk } },
    },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deletePayoutRoute = createRoute({
  method: 'delete',
  path: '/payouts/{id}',
  tags: ['salaries'],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Payout deleted', content: { 'application/json': { schema: deleteOk } } },
    400: respValidation,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listSalariesRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { month } = c.req.valid('query')
    try {
      const rows = await listSalaries(month)
      baseLogger.info(
        { event: 'salaries.list', request_id: requestId, month, count: rows.length, status: 200 },
        'Salaries listed',
      )
      return c.json({ ok: true as const, month, rows }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'salaries.list.error',
          request_id: requestId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Salaries query failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(setRateRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { masterId, hourlyRate } = c.req.valid('json')
    try {
      await setMasterRate(masterId, hourlyRate)
      baseLogger.info(
        { event: 'salaries.rate.set', request_id: requestId, master_id: masterId, status: 200 },
        'Master rate set',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof SalaryError && err.code === 'master_not_found') {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      return salaryErrorFallback(c, err)
    }
  })
  .openapi(listEntriesRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { masterId, month } = c.req.valid('query')
    try {
      const { hours, payouts } = await listMasterEntries(masterId, month)
      const entries = mergeSalaryEntries(hours.map(toWire), payouts.map(payoutToWire))
      baseLogger.info(
        {
          event: 'salaries.entries.list',
          request_id: requestId,
          master_id: masterId,
          month,
          count: entries.length,
          status: 200,
        },
        'Salary entries listed',
      )
      return c.json({ ok: true as const, entries }, StatusCodes.OK)
    } catch (err) {
      baseLogger.error(
        {
          event: 'salaries.entries.list.error',
          request_id: requestId,
          master_id: masterId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Salary entries query failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(createWorkHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { masterId, workDate, hours, note } = c.req.valid('json')
    try {
      const row = await createWorkHours({
        masterId,
        workDate,
        minutes: hoursToMinutes(hours),
        note: note ?? '',
      })
      baseLogger.info(
        {
          event: 'salaries.hours.create',
          request_id: requestId,
          work_hours_id: row.id,
          master_id: masterId,
          status: 201,
        },
        'Work hours created',
      )
      return c.json({ ok: true as const, hours: toWire(row) }, StatusCodes.CREATED)
    } catch (err) {
      // Единственная доменная ошибка create — no_rate (400). Обрабатывается на месте, а не
      // через salaryErrorFallback, который расширил бы union кодом 404, который этот
      // маршрут не отдает и не объявляет.
      if (err instanceof SalaryError && err.code === 'no_rate') {
        return c.json(
          { ok: false as const, error: 'validation' as const, reason: 'no_rate' as const },
          StatusCodes.BAD_REQUEST,
        )
      }
      baseLogger.error(
        { message: err instanceof Error ? err.message : String(err) },
        'Work hours create failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(updateWorkHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    // На входе часы (шаг 0.25) → минуты; снимок ставки при правке
    // никогда не трогается.
    const patch: WorkHoursPatch = {}
    if (body.workDate !== undefined) patch.workDate = body.workDate
    if (body.hours !== undefined) patch.minutes = hoursToMinutes(body.hours)
    if (body.note !== undefined) patch.note = body.note

    try {
      const row = await updateWorkHours(id, patch)
      baseLogger.info(
        { event: 'salaries.hours.update', request_id: requestId, work_hours_id: id, status: 200 },
        'Work hours updated',
      )
      return c.json({ ok: true as const, hours: toWire(row) }, StatusCodes.OK)
    } catch (err) {
      return salaryErrorFallback(c, err)
    }
  })
  .openapi(deleteWorkHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    try {
      await deleteWorkHours(id)
      baseLogger.info(
        { event: 'salaries.hours.delete', request_id: requestId, work_hours_id: id, status: 200 },
        'Work hours deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return salaryErrorFallback(c, err)
    }
  })
  .openapi(createPayoutRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { masterId, payoutDate, amount, note } = c.req.valid('json')
    try {
      const row = await createPayout({ masterId, payoutDate, amount, note: note ?? '' })
      baseLogger.info(
        {
          event: 'salaries.payout.create',
          request_id: requestId,
          payout_id: row.id,
          master_id: masterId,
          status: 201,
        },
        'Payout created',
      )
      return c.json({ ok: true as const, payout: payoutToWire(row) }, StatusCodes.CREATED)
    } catch (err) {
      // Единственная доменная ошибка create — master_not_found (404); строки еще
      // нет, поэтому пометить сбой payout_id нечем.
      if (err instanceof SalaryError && err.code === 'master_not_found') {
        return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
      }
      baseLogger.error(
        {
          event: 'salaries.payout.create.error',
          request_id: requestId,
          master_id: masterId,
          message: err instanceof Error ? err.message : String(err),
          status: 500,
        },
        'Payout create failed',
      )
      return c.json(
        { ok: false as const, error: 'internal' as const },
        StatusCodes.INTERNAL_SERVER_ERROR,
      )
    }
  })
  .openapi(updatePayoutRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    // При правке мастер никогда не меняется — меняются только день, сумма и примечание.
    const patch: PayoutPatch = {}
    if (body.payoutDate !== undefined) patch.payoutDate = body.payoutDate
    if (body.amount !== undefined) patch.amount = body.amount
    if (body.note !== undefined) patch.note = body.note

    try {
      const row = await updatePayout(id, patch)
      baseLogger.info(
        { event: 'salaries.payout.update', request_id: requestId, payout_id: id, status: 200 },
        'Payout updated',
      )
      return c.json({ ok: true as const, payout: payoutToWire(row) }, StatusCodes.OK)
    } catch (err) {
      return payoutErrorFallback(c, err, 'salaries.payout.update.error', requestId, id)
    }
  })
  .openapi(deletePayoutRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    try {
      await deletePayout(id)
      baseLogger.info(
        { event: 'salaries.payout.delete', request_id: requestId, payout_id: id, status: 200 },
        'Payout deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return payoutErrorFallback(c, err, 'salaries.payout.delete.error', requestId, id)
    }
  })

export default router
