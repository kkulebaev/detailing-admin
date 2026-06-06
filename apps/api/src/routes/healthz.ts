import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { unavailableErrorSchema } from '@detailing-admin/shared'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
} from '../boot.js'

const healthzOkSchema = z.object({ ok: z.literal(true), time: z.string() })

const healthzRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['health'],
  responses: {
    200: {
      description: 'Service healthy',
      content: { 'application/json': { schema: healthzOkSchema } },
    },
    503: {
      description: 'Boot blocked',
      content: { 'application/json': { schema: unavailableErrorSchema } },
    },
  },
})

const router = new OpenAPIHono().openapi(healthzRoute, (c) => {
  const state = getBootState()
  if (state !== 'ok') {
    if (state === 'headers_mismatch') {
      const mismatch = getBootHeadersMismatch()
      return c.json(
        {
          ok: false as const,
          error: 'unavailable' as const,
          reason: 'headers_mismatch' as const,
          column_index: mismatch?.column_index ?? 0,
          expected: mismatch?.expected ?? '',
          observed: mismatch?.observed ?? '',
        },
        503,
      )
    }
    return c.json(
      {
        ok: false as const,
        error: 'unavailable' as const,
        reason: 'not_configured' as const,
        message: getBootNotConfiguredMessage() ?? 'Boot initialization failed',
      },
      503,
    )
  }
  return c.json({ ok: true as const, time: new Date().toISOString() }, 200)
})

export default router
