import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { env } from './env.js'
import healthzRouter from './routes/healthz.js'
import bookingsRouter from './routes/bookings.js'
import clientsRouter from './routes/clients.js'
import pricelistRouter from './routes/pricelist.js'

// Return type is intentionally inferred — `hc<AppType>` on the web side needs
// the full chained route table, which is lost the moment you annotate this as
// `Hono`. Don't add an explicit return type.
export function createApp() {
  const app = new Hono()
    .use(
      '/api/*',
      cors({
        origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
        allowMethods: ['POST', 'GET', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Idempotency-Key'],
        exposeHeaders: ['X-Request-Id'],
      }),
    )
    // Defence-in-depth: cap any /api/* body at 64 KB (largest legitimate
    // booking is ~4 KB; on overflow Hono returns the default 413).
    .use('/api/*', bodyLimit({ maxSize: 64 * 1024 }))
    .route('/healthz', healthzRouter)
    .route('/api/bookings', bookingsRouter)
    .route('/api/clients', clientsRouter)
    .route('/api/pricelist', pricelistRouter)
    .notFound((c) => c.json({ ok: false as const, error: 'not_found' as const }, 404))

  return app
}

export type AppType = ReturnType<typeof createApp>
