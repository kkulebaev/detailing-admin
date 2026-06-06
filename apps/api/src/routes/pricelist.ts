import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { sectionInputSchema, serviceInputSchema } from '@detailing-admin/shared/pricelist'
import { isDbReady } from '../boot.js'
import {
  PricelistError,
  createSection,
  createService,
  deleteSection,
  deleteService,
  listPricelist,
  updateSection,
  updateService,
} from '../db/pricelist.js'
import { baseLogger } from '../log.js'

const router = new Hono()

function unavailable(c: Parameters<Parameters<typeof router.get>[1]>[0]) {
  return c.json(
    {
      ok: false as const,
      error: 'unavailable' as const,
      reason: 'not_configured' as const,
      message: 'Database not configured or migrations failed',
    },
    503,
  )
}

function dbGuard(c: Parameters<Parameters<typeof router.get>[1]>[0]) {
  if (!isDbReady()) return unavailable(c)
  return null
}

function pricelistErrorResponse(c: Parameters<Parameters<typeof router.get>[1]>[0], err: unknown) {
  if (err instanceof PricelistError) {
    if (err.code === 'not_found') {
      return c.json({ ok: false as const, error: 'not_found' as const }, 404)
    }
    return c.json({ ok: false as const, error: 'conflict' as const, reason: err.code }, 409)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Pricelist mutation failed',
  )
  return c.json({ ok: false as const, error: 'internal' as const }, 500)
}

function parseIdParam(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

router.get('/', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  try {
    const sectionsWithServices = await listPricelist()
    const servicesCount = sectionsWithServices.reduce((acc, s) => acc + s.services.length, 0)
    baseLogger.info(
      {
        event: 'pricelist.list',
        request_id: requestId,
        sections: sectionsWithServices.length,
        services: servicesCount,
        status: 200,
      },
      'Pricelist listed',
    )
    return c.json({ ok: true as const, sections: sectionsWithServices }, 200)
  } catch (err) {
    baseLogger.error(
      {
        event: 'pricelist.list.error',
        request_id: requestId,
        message: err instanceof Error ? err.message : String(err),
        status: 500,
      },
      'Pricelist query failed',
    )
    return c.json({ ok: false as const, error: 'internal' as const }, 500)
  }
})

router.post('/sections', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }
  const parsed = sectionInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const section = await createSection(parsed.data.name)
    baseLogger.info(
      { event: 'pricelist.section.create', request_id: requestId, section_id: section.id, status: 201 },
      'Section created',
    )
    return c.json({ ok: true as const, section }, 201)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

router.patch('/sections/:id', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  const id = parseIdParam(c.req.param('id'))
  if (id === null) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: ['id'], message: 'Invalid id' }],
      },
      400,
    )
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }
  const parsed = sectionInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const section = await updateSection(id, parsed.data.name)
    baseLogger.info(
      { event: 'pricelist.section.update', request_id: requestId, section_id: id, status: 200 },
      'Section updated',
    )
    return c.json({ ok: true as const, section }, 200)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

router.delete('/sections/:id', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  const id = parseIdParam(c.req.param('id'))
  if (id === null) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: ['id'], message: 'Invalid id' }],
      },
      400,
    )
  }

  try {
    await deleteSection(id)
    baseLogger.info(
      { event: 'pricelist.section.delete', request_id: requestId, section_id: id, status: 200 },
      'Section deleted',
    )
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

router.post('/services', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }
  const parsed = serviceInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const service = await createService(parsed.data)
    baseLogger.info(
      {
        event: 'pricelist.service.create',
        request_id: requestId,
        service_id: service.id,
        section_id: service.sectionId,
        status: 201,
      },
      'Service created',
    )
    return c.json({ ok: true as const, service }, 201)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

router.patch('/services/:id', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  const id = parseIdParam(c.req.param('id'))
  if (id === null) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: ['id'], message: 'Invalid id' }],
      },
      400,
    )
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }
  const parsed = serviceInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const service = await updateService(id, parsed.data)
    baseLogger.info(
      {
        event: 'pricelist.service.update',
        request_id: requestId,
        service_id: id,
        section_id: service.sectionId,
        status: 200,
      },
      'Service updated',
    )
    return c.json({ ok: true as const, service }, 200)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

router.delete('/services/:id', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  const id = parseIdParam(c.req.param('id'))
  if (id === null) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: ['id'], message: 'Invalid id' }],
      },
      400,
    )
  }

  try {
    await deleteService(id)
    baseLogger.info(
      { event: 'pricelist.service.delete', request_id: requestId, service_id: id, status: 200 },
      'Service deleted',
    )
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    return pricelistErrorResponse(c, err)
  }
})

export default router
