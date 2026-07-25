import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { env } from './env.js'
import healthzRouter from './routes/healthz.js'
import bookingsRouter from './routes/bookings.js'
import clientsRouter from './routes/clients.js'
import pricelistRouter from './routes/pricelist.js'
import mastersRouter from './routes/masters.js'

export function createApp() {
  // Built imperatively rather than chained so the OpenAPIHono type survives
  // through `.notFound()` (the chained form widens to plain Hono, which then
  // loses `.doc()`). The web client is orval-generated off the OpenAPI doc
  // rather than `hc<AppType>`, so chained AppType inference doesn't matter here.
  const app = new OpenAPIHono()

  app.use(
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
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }))

  app.route('/healthz', healthzRouter)
  app.route('/api/bookings', bookingsRouter)
  app.route('/api/clients', clientsRouter)
  app.route('/api/pricelist', pricelistRouter)
  app.route('/api/masters', mastersRouter)

  app.notFound((c) => c.json({ ok: false as const, error: 'not_found' as const }, 404))

  // OpenAPI document served at `/openapi.json`. Drives the orval-generated
  // web client; also handy for manual inspection in dev.
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      version: '0.0.1',
      title: 'Detailing Admin API',
      description: 'Internal API for the detailing booking form and admin panel.',
    },
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
