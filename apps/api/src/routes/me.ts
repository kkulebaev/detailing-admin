import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  computeSalary,
  dbUnavailableErrorSchema,
  hoursToMinutes,
  internalErrorSchema,
  isInSelfEditWindow,
  mergeSalaryEntries,
  monthSchema,
  mySalaryOkSchema,
  notFoundErrorSchema,
  selfEditWindow,
  selfWorkHoursErrorSchema,
  selfWorkHoursInputSchema,
  validationErrorSchema,
  workHoursSchema,
  workHoursUpdateSchema,
} from '@detailing-admin/shared'
import { isDbReady } from '../boot.js'
import { findMasterByUserId } from '../db/masters.js'
import {
  SalaryError,
  createWorkHours,
  deleteWorkHours,
  getMasterRate,
  getWorkHoursById,
  listMasterEntries,
  updateWorkHours,
  type WorkHoursPatch,
} from '../db/salaries.js'
import type { Master, WorkHoursRow } from '../db/schema.js'
import { SHOP_TIMEZONE } from '../export.js'
import { baseLogger } from '../log.js'
import { defaultValidationHook } from '../openapi.js'

// «Мои часы»: вошедший аккаунт работает только с привязанным к нему мастером
// (masters.userId) и ни с чем больше. Мастер определяется на каждый запрос по `sub`
// из сессии и никогда не берётся от клиента.

const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const workHoursMutationOk = z.object({ ok: z.literal(true), hours: workHoursSchema })
const deleteOk = z.object({ ok: z.literal(true) })

// Окно редактирования — календарное правило, поэтому «сегодня» — это день студии,
// а не UTC-день сервера: около полуночи они расходятся.
function shopToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE }).format(new Date())
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

function selfError(c: Context, reason: 'no_rate' | 'not_linked' | 'outside_window') {
  return c.json(
    { ok: false as const, error: 'validation' as const, reason },
    StatusCodes.BAD_REQUEST,
  )
}

function notFound(c: Context) {
  return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
}

function internal(c: Context, event: string, requestId: string, err: unknown) {
  baseLogger.error(
    {
      event,
      request_id: requestId,
      message: err instanceof Error ? err.message : String(err),
      status: 500,
    },
    'Own work hours request failed',
  )
  return c.json(
    { ok: false as const, error: 'internal' as const },
    StatusCodes.INTERNAL_SERVER_ERROR,
  )
}

function toWire<T extends { createdAt: Date }>(row: T) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

// На чужую запись отвечаем 404, а не 403: сотруднику незачем знать,
// какие id существуют.
async function ownRecord(master: Master, id: number): Promise<WorkHoursRow | undefined> {
  const row = await getWorkHoursById(id)
  return row && row.masterId === master.id ? row : undefined
}

const respValidation = {
  description: 'Validation error',
  content: { 'application/json': { schema: validationErrorSchema } },
}
const respSelfError = {
  description: 'No rate, account not linked to a master, or day outside the edit window',
  content: { 'application/json': { schema: selfWorkHoursErrorSchema } },
}
const respNotFound = {
  description: 'Not found',
  content: { 'application/json': { schema: notFoundErrorSchema } },
}
const respDbUnavailable = {
  description: 'Database unavailable',
  content: { 'application/json': { schema: dbUnavailableErrorSchema } },
}
const respInternal = {
  description: 'Internal server error',
  content: { 'application/json': { schema: internalErrorSchema } },
}

const getSalaryRoute = createRoute({
  method: 'get',
  path: '/salary',
  tags: ['me'],
  request: { query: z.object({ month: monthSchema }) },
  responses: {
    200: {
      description: 'Own hours and pay for the month',
      content: { 'application/json': { schema: mySalaryOkSchema } },
    },
    400: respValidation,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createHoursRoute = createRoute({
  method: 'post',
  path: '/hours',
  tags: ['me'],
  request: { body: { content: { 'application/json': { schema: selfWorkHoursInputSchema } } } },
  responses: {
    201: {
      description: 'Work hours added',
      content: { 'application/json': { schema: workHoursMutationOk } },
    },
    // Ошибка zod-валидации тела — тоже 400, в форме с issues.
    400: respSelfError,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateHoursRoute = createRoute({
  method: 'patch',
  path: '/hours/{id}',
  tags: ['me'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: workHoursUpdateSchema } } },
  },
  responses: {
    200: {
      description: 'Work hours updated',
      content: { 'application/json': { schema: workHoursMutationOk } },
    },
    400: respSelfError,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteHoursRoute = createRoute({
  method: 'delete',
  path: '/hours/{id}',
  tags: ['me'],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'Work hours deleted',
      content: { 'application/json': { schema: deleteOk } },
    },
    400: respSelfError,
    404: respNotFound,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(getSalaryRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { month } = c.req.valid('query')
    const window = selfEditWindow(shopToday())
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) {
        return c.json(
          {
            ok: true as const,
            month,
            master: null,
            hourlyRate: null,
            totalMinutes: 0,
            hoursSalary: 0,
            payoutsTotal: 0,
            total: 0,
            entries: [],
            editableFrom: window.from,
            editableTo: window.to,
          },
          StatusCodes.OK,
        )
      }

      const [hourlyRate, { hours, payouts }] = await Promise.all([
        getMasterRate(master.id),
        listMasterEntries(master.id, month),
      ])
      const hoursSalary = computeSalary(
        hours.map((h) => ({ minutes: h.minutes, rate: h.rateSnapshot })),
      )
      const payoutsTotal = payouts.reduce((sum, p) => sum + p.amount, 0)
      const entries = mergeSalaryEntries(hours.map(toWire), payouts.map(toWire))

      baseLogger.info(
        { event: 'me.salary', request_id: requestId, master_id: master.id, month, status: 200 },
        'Own salary listed',
      )
      return c.json(
        {
          ok: true as const,
          month,
          master: { id: master.id, name: master.name },
          hourlyRate,
          totalMinutes: hours.reduce((sum, h) => sum + h.minutes, 0),
          hoursSalary,
          payoutsTotal,
          total: hoursSalary + payoutsTotal,
          entries,
          editableFrom: window.from,
          editableTo: window.to,
        },
        StatusCodes.OK,
      )
    } catch (err) {
      return internal(c, 'me.salary.error', requestId, err)
    }
  })
  .openapi(createHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const input = c.req.valid('json')
    if (!isInSelfEditWindow(input.workDate, shopToday())) return selfError(c, 'outside_window')
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) return selfError(c, 'not_linked')

      const row = await createWorkHours({
        masterId: master.id,
        workDate: input.workDate,
        minutes: hoursToMinutes(input.hours),
        note: input.note ?? '',
      })
      baseLogger.info(
        {
          event: 'me.hours.create',
          request_id: requestId,
          master_id: master.id,
          hours_id: row.id,
          status: 201,
        },
        'Own work hours added',
      )
      return c.json({ ok: true as const, hours: toWire(row) }, StatusCodes.CREATED)
    } catch (err) {
      if (err instanceof SalaryError && err.code === 'no_rate') return selfError(c, 'no_rate')
      return internal(c, 'me.hours.create.error', requestId, err)
    }
  })
  .openapi(updateHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const today = shopToday()
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) return selfError(c, 'not_linked')
      const existing = await ownRecord(master, id)
      if (!existing) return notFound(c)
      // Проверяются обе даты: старую запись нельзя затащить в окно,
      // а свежую — вытолкнуть из него.
      if (!isInSelfEditWindow(existing.workDate, today)) return selfError(c, 'outside_window')
      if (input.workDate !== undefined && !isInSelfEditWindow(input.workDate, today)) {
        return selfError(c, 'outside_window')
      }

      const patch: WorkHoursPatch = {}
      if (input.workDate !== undefined) patch.workDate = input.workDate
      if (input.hours !== undefined) patch.minutes = hoursToMinutes(input.hours)
      if (input.note !== undefined) patch.note = input.note
      const row = await updateWorkHours(id, patch)
      baseLogger.info(
        {
          event: 'me.hours.update',
          request_id: requestId,
          master_id: master.id,
          hours_id: id,
          status: 200,
        },
        'Own work hours updated',
      )
      return c.json({ ok: true as const, hours: toWire(row) }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof SalaryError && err.code === 'not_found') return notFound(c)
      return internal(c, 'me.hours.update.error', requestId, err)
    }
  })
  .openapi(deleteHoursRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    try {
      const master = await findMasterByUserId(c.get('user').sub)
      if (!master) return selfError(c, 'not_linked')
      const existing = await ownRecord(master, id)
      if (!existing) return notFound(c)
      if (!isInSelfEditWindow(existing.workDate, shopToday())) return selfError(c, 'outside_window')

      await deleteWorkHours(id)
      baseLogger.info(
        {
          event: 'me.hours.delete',
          request_id: requestId,
          master_id: master.id,
          hours_id: id,
          status: 200,
        },
        'Own work hours deleted',
      )
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      if (err instanceof SalaryError && err.code === 'not_found') return notFound(c)
      return internal(c, 'me.hours.delete.error', requestId, err)
    }
  })

export default router
