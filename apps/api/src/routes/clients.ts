import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
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
const idParamSchema = z.object({ id: z.string().regex(UUID_RE) })

// zValidator hook — maps Zod failures to our shared `{ ok:false, error:'validation' }`
// shape so the wire contract stays byte-identical to the pre-RPC version.
const onValidate = (
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
      const rows = await listClients()
      baseLogger.info(
        { event: 'clients.list', request_id: requestId, count: rows.length, status: 200 },
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
  .post('/', zValidator('json', clientInputSchema, onValidate), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { phone, name } = c.req.valid('json')
    try {
      const client = await createClient(phone, name)
      baseLogger.info(
        { event: 'clients.create', request_id: requestId, client_id: client.id, status: 201 },
        'Client created',
      )
      return c.json({ ok: true as const, client }, 201)
    } catch (err) {
      return clientErrorResponse(c, err)
    }
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, onValidateId),
    zValidator('json', clientInputSchema, onValidate),
    async (c) => {
      const requestId = uuidv4()
      c.header('X-Request-Id', requestId)

      if (!isDbReady()) return unavailable(c)

      const { id } = c.req.valid('param')
      const { phone, name } = c.req.valid('json')

      try {
        const client = await updateClient(id, phone, name)
        baseLogger.info(
          { event: 'clients.update', request_id: requestId, client_id: id, status: 200 },
          'Client updated',
        )
        return c.json({ ok: true as const, client }, 200)
      } catch (err) {
        return clientErrorResponse(c, err)
      }
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, onValidateId), async (c) => {
    const requestId = uuidv4()
    c.header('X-Request-Id', requestId)

    if (!isDbReady()) return unavailable(c)

    const { id } = c.req.valid('param')

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

export type ClientsRoute = typeof router
export default router
