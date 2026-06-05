import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { isDbReady } from '../boot.js'
import { listClients } from '../db/clients.js'
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
    const rows = await listClients()
    baseLogger.info(
      {
        event: 'clients.list',
        request_id: requestId,
        count: rows.length,
        status: 200,
      },
      'Clients listed',
    )
    return c.json({ ok: true as const, clients: rows }, 200)
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
    return c.json({ ok: false as const, error: 'internal' as const }, 500)
  }
})

export default router
