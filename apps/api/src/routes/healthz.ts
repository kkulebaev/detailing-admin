import { Hono } from 'hono'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
} from '../boot.js'

const router = new Hono()

router.get('/', (c) => {
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
