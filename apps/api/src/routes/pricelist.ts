import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { isDbReady } from '../boot.js'
import { listPricelist } from '../db/pricelist.js'
import { baseLogger } from '../log.js'

const router = new Hono()

router.get('/', async (c) => {
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
      503,
    )
  }

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

export default router
