import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import {
  StatusCodes,
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  pricelistSectionRowSchema,
  pricelistSectionSchema,
  pricelistServiceSchema,
  sectionInputSchema,
  serviceInputSchema,
  validationErrorSchema,
} from '@detailing-admin/shared'
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
import { defaultValidationHook } from '../openapi.js'

// Numeric path param. `z.coerce.number()` would silently accept "12abc" → NaN;
// pin the format with a regex first, then convert.
const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform((v) => Number(v)),
})

const pricelistConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.union([z.literal('duplicate_name'), z.literal('has_services')]),
})

const listOk = z.object({ ok: z.literal(true), sections: z.array(pricelistSectionSchema) })
const sectionMutationOk = z.object({ ok: z.literal(true), section: pricelistSectionRowSchema })
const serviceMutationOk = z.object({ ok: z.literal(true), service: pricelistServiceSchema })
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

// Description trim + empty-to-null normalization that used to live in the
// schema's `.transform()`. Pulled out into the handler so orval can generate a
// clean `string | null` TS type from the wire schema.
type ServicePayload = {
  sectionId: number
  name: string
  description: string | null
  priceClass1Min: number
  priceClass1Max: number | null
  priceClass2Min: number
  priceClass2Max: number | null
  priceClass3Min: number
  priceClass3Max: number | null
  priceClass4Min: number
  priceClass4Max: number | null
}
function normalizeServicePayload(input: ServicePayload): ServicePayload {
  const desc = input.description
  let description: string | null
  if (desc === null) description = null
  else {
    const trimmed = desc.trim()
    description = trimmed.length === 0 ? null : trimmed
  }
  // A degenerate range (max == min) is stored as a fixed price so the UI never
  // renders «5000–5000 ₽».
  const collapse = (min: number, max: number | null) => (max === min ? null : max)
  return {
    ...input,
    description,
    priceClass1Max: collapse(input.priceClass1Min, input.priceClass1Max),
    priceClass2Max: collapse(input.priceClass2Min, input.priceClass2Max),
    priceClass3Max: collapse(input.priceClass3Min, input.priceClass3Max),
    priceClass4Max: collapse(input.priceClass4Min, input.priceClass4Max),
  }
}

function pricelistErrorResponse(c: Context, err: unknown) {
  if (err instanceof PricelistError) {
    if (err.code === 'not_found') {
      return c.json({ ok: false as const, error: 'not_found' as const }, StatusCodes.NOT_FOUND)
    }
    return c.json({ ok: false as const, error: 'conflict' as const, reason: err.code }, StatusCodes.CONFLICT)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Pricelist mutation failed',
  )
  return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
}

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
const respConflict = {
  description: 'Conflict (duplicate name or has services)',
  content: { 'application/json': { schema: pricelistConflictSchema } },
}

const listPricelistRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['pricelist'],
  responses: {
    200: { description: 'Pricelist', content: { 'application/json': { schema: listOk } } },
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createSectionRoute = createRoute({
  method: 'post',
  path: '/sections',
  tags: ['pricelist'],
  request: { body: { content: { 'application/json': { schema: sectionInputSchema } } } },
  responses: {
    201: { description: 'Section created', content: { 'application/json': { schema: sectionMutationOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateSectionRoute = createRoute({
  method: 'patch',
  path: '/sections/{id}',
  tags: ['pricelist'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: sectionInputSchema } } },
  },
  responses: {
    200: { description: 'Section updated', content: { 'application/json': { schema: sectionMutationOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteSectionRoute = createRoute({
  method: 'delete',
  path: '/sections/{id}',
  tags: ['pricelist'],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Section deleted', content: { 'application/json': { schema: deleteOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const createServiceRoute = createRoute({
  method: 'post',
  path: '/services',
  tags: ['pricelist'],
  request: { body: { content: { 'application/json': { schema: serviceInputSchema } } } },
  responses: {
    201: { description: 'Service created', content: { 'application/json': { schema: serviceMutationOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const updateServiceRoute = createRoute({
  method: 'patch',
  path: '/services/{id}',
  tags: ['pricelist'],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: serviceInputSchema } } },
  },
  responses: {
    200: { description: 'Service updated', content: { 'application/json': { schema: serviceMutationOk } } },
    400: respValidation,
    404: respNotFound,
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const deleteServiceRoute = createRoute({
  method: 'delete',
  path: '/services/{id}',
  tags: ['pricelist'],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Service deleted', content: { 'application/json': { schema: deleteOk } } },
    400: respValidation,
    404: respNotFound,
    // The shared `pricelistErrorResponse` mapper can technically return 409 for
    // any `PricelistError` even though deleteService never throws conflict in
    // practice. Declared so the route signature accepts the handler's union.
    409: respConflict,
    500: respInternal,
    503: respDbUnavailable,
  },
})

const router = new OpenAPIHono({ defaultHook: defaultValidationHook })
  .openapi(listPricelistRoute, async (c) => {
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
      return c.json({ ok: true as const, sections: sectionsWithServices }, StatusCodes.OK)
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
      return c.json({ ok: false as const, error: 'internal' as const }, StatusCodes.INTERNAL_SERVER_ERROR)
    }
  })
  .openapi(createSectionRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { name } = c.req.valid('json')
    try {
      const section = await createSection(name)
      baseLogger.info(
        { event: 'pricelist.section.create', request_id: requestId, section_id: section.id, status: 201 },
        'Section created',
      )
      return c.json({ ok: true as const, section }, StatusCodes.CREATED)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .openapi(updateSectionRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const { name } = c.req.valid('json')

    try {
      const section = await updateSection(id, name)
      baseLogger.info(
        { event: 'pricelist.section.update', request_id: requestId, section_id: id, status: 200 },
        'Section updated',
      )
      return c.json({ ok: true as const, section }, StatusCodes.OK)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .openapi(deleteSectionRoute, async (c) => {
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
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .openapi(createServiceRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const payload = normalizeServicePayload(c.req.valid('json'))
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
      return c.json({ ok: true as const, service }, StatusCodes.CREATED)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .openapi(updateServiceRoute, async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')
    const payload = normalizeServicePayload(c.req.valid('json'))

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
      return c.json({ ok: true as const, service }, StatusCodes.OK)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })
  .openapi(deleteServiceRoute, async (c) => {
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
      return c.json({ ok: true as const }, StatusCodes.OK)
    } catch (err) {
      return pricelistErrorResponse(c, err)
    }
  })

export default router
