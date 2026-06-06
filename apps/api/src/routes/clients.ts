import { Hono, type Context } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { clientInputSchema } from '@detailing-admin/shared/client'
import { isDbReady } from '../boot.js'
import {
  ClientError,
  createClient,
  deleteClient,
  listClients,
  updateClient,
} from '../db/clients.js'
import { baseLogger } from '../log.js'

const router = new Hono()

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

function dbGuard(c: Context) {
  if (!isDbReady()) return unavailable(c)
  return null
}

function clientErrorResponse(c: Context, err: unknown) {
  if (err instanceof ClientError) {
    if (err.code === 'not_found') {
      return c.json({ ok: false as const, error: 'not_found' as const }, 404)
    }
    return c.json({ ok: false as const, error: 'conflict' as const, reason: err.code }, 409)
  }
  baseLogger.error(
    { message: err instanceof Error ? err.message : String(err) },
    'Client mutation failed',
  )
  return c.json({ ok: false as const, error: 'internal' as const }, 500)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseIdParam(raw: string): string | null {
  return UUID_RE.test(raw) ? raw : null
}

async function readBody(c: Context) {
  try {
    return { ok: true as const, value: await c.req.json() }
  } catch {
    return { ok: false as const }
  }
}

router.get('/', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

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

router.post('/', async (c) => {
  const requestId = uuidv4()
  c.header('X-Request-Id', requestId)

  const guard = dbGuard(c)
  if (guard) return guard

  const body = await readBody(c)
  if (!body.ok) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }

  const parsed = clientInputSchema.safeParse(body.value)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const client = await createClient(parsed.data.phone, parsed.data.name)
    baseLogger.info(
      { event: 'clients.create', request_id: requestId, client_id: client.id, status: 201 },
      'Client created',
    )
    return c.json({ ok: true as const, client }, 201)
  } catch (err) {
    return clientErrorResponse(c, err)
  }
})

router.patch('/:id', async (c) => {
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

  const body = await readBody(c)
  if (!body.ok) {
    return c.json(
      {
        ok: false as const,
        error: 'validation' as const,
        issues: [{ path: [] as (string | number)[], message: 'Invalid JSON' }],
      },
      400,
    )
  }

  const parsed = clientInputSchema.safeParse(body.value)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }

  try {
    const client = await updateClient(id, parsed.data.phone, parsed.data.name)
    baseLogger.info(
      { event: 'clients.update', request_id: requestId, client_id: id, status: 200 },
      'Client updated',
    )
    return c.json({ ok: true as const, client }, 200)
  } catch (err) {
    return clientErrorResponse(c, err)
  }
})

router.delete('/:id', async (c) => {
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
    await deleteClient(id)
    baseLogger.info(
      { event: 'clients.delete', request_id: requestId, client_id: id, status: 200 },
      'Client deleted',
    )
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    return clientErrorResponse(c, err)
  }
})

export default router
