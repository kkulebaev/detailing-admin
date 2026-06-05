import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { env } from './env.js'
import healthzRouter from './routes/healthz.js'
import bookingsRouter from './routes/bookings.js'
import clientsRouter from './routes/clients.js'
import pricelistRouter from './routes/pricelist.js'

export function createApp(): Hono {
  const app = new Hono()

  // CORS for all API routes — allow only configured origin(s).
  app.use(
    '/api/*',
    cors({
      origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
      allowMethods: ['POST', 'GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )

  // Defence-in-depth: cap any /api/* body at 64 KB (largest legitimate
  // booking is ~4 KB; on overflow Hono returns the default 413).
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }))

  app.route('/healthz', healthzRouter)
  app.route('/api/bookings', bookingsRouter)
  app.route('/api/clients', clientsRouter)
  app.route('/api/pricelist', pricelistRouter)

  app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404))

  return app
}
