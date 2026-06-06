import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
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

function unavailable(c: Context) {
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

function pricelistErrorResponse(c: Context, err: unknown) {
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

// Numeric path param. `z.coerce.number()` would silently accept "12abc" → NaN;
// pin the format with a regex first, then convert.
const idParamSchema = z
  .object({ id: z.string().regex(/^[1-9]\d*$/) })
  .transform((v) => ({ id: Number(v.id) }))

const onValidateJson = (
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context,
) => {
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }
}

const onValidateId = (
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context,
) => {
  if (!result.success) {
    const issues: { path: (string | number)[]; message: string }[] = [
      { path: ['id'], message: 'Invalid id' },
    ]
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }
}

const router = new Hono()
  .get('/', async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

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
  .post('/sections', zValidator('json', sectionInputSchema, onValidateJson), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { name } = c.req.valid('json')
    try {
      const section = await createSection(name)
      baseLogger.info(
        {
          event: 'pricelist.section.create',
          request_id: requestId,
          section_id: section.id,
          status: 201,
        },
        'Section created',
      )
      return c.json({ ok: true as const, section }, 201)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .patch(
    '/sections/:id',
    zValidator('param', idParamSchema, onValidateId),
    zValidator('json', sectionInputSchema, onValidateJson),
    async (c) => {
      const requestId = uuidv4()
      c.header('X-Request-Id', requestId)

      if (!isDbReady()) return unavailable(c)

      const { id } = c.req.valid('param')
      const { name } = c.req.valid('json')

      try {
        const section = await updateSection(id, name)
        baseLogger.info(
          {
            event: 'pricelist.section.update',
            request_id: requestId,
            section_id: id,
            status: 200,
          },
          'Section updated',
        )
        return c.json({ ok: true as const, section }, 200)
      } catch (err) {
        return pricelistErrorResponse(c, err)
      }
    },
  )
  .delete('/sections/:id', zValidator('param', idParamSchema, onValidateId), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')

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
  .post('/services', zValidator('json', serviceInputSchema, onValidateJson), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const payload = c.req.valid('json')
    try {
      const service = await createService(payload)
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
  .patch(
    '/services/:id',
    zValidator('param', idParamSchema, onValidateId),
    zValidator('json', serviceInputSchema, onValidateJson),
    async (c) => {
      const requestId = uuidv4()
      c.header('X-Request-Id', requestId)

      if (!isDbReady()) return unavailable(c)

      const { id } = c.req.valid('param')
      const payload = c.req.valid('json')

      try {
        const service = await updateService(id, payload)
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
    },
  )
  .delete('/services/:id', zValidator('param', idParamSchema, onValidateId), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')

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

export type PricelistRoute = typeof router
export default router
