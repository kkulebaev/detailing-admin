import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { env } from './env.js'
import healthzRouter from './routes/healthz.js'
import authRouter from './routes/auth.js'
import bookingsRouter from './routes/bookings.js'
import clientsRouter from './routes/clients.js'
import pricelistRouter from './routes/pricelist.js'
import mastersRouter from './routes/masters.js'
import salariesRouter from './routes/salaries.js'
import analyticsRouter from './routes/analytics.js'
import { requireAuth, requireAdmin } from './auth/middleware.js'

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
      // credentials:true so the browser attaches/accepts the auth cookie. The
      // Allow-Credentials header rides even on 401s (CORS runs before auth), so
      // the SPA can read a rejected response. First-party topology (plan §3-bis)
      // means this is belt-and-suspenders, not load-bearing.
      credentials: true,
      allowMethods: ['POST', 'GET', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  // Defence-in-depth: cap any /api/* body at 64 KB (largest legitimate
  // booking is ~4 KB; on overflow Hono returns the default 413).
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }))

  // Auth endpoints stay outside the guards: login/logout/me are public by
  // construction; change-password guards itself internally. Registered before
  // the guards so the wildcards below never shadow it.
  app.route('/api/auth', authRouter)

  // Everything else under /api is admin-only. The `/*` wildcard also covers the
  // bare collection path (POST /api/bookings) under Hono's matching, and the
  // stateless requireAuth keeps the booking flow independent of Postgres.
  // The bookings list (GET) is available to any authenticated role — amounts are
  // hidden from non-admins in the handler. Writes (POST) stay admin-only.
  app.use('/api/bookings/*', requireAuth)
  app.use('/api/bookings/*', (c, next) =>
    c.req.method === 'GET' ? next() : requireAdmin(c, next),
  )
  app.use('/api/clients/*', requireAuth, requireAdmin)
  app.use('/api/pricelist/*', requireAuth, requireAdmin)
  app.use('/api/salaries/*', requireAuth, requireAdmin)
  // Analytics exposes revenue sums — admin-only, like the other sensitive reads.
  app.use('/api/analytics/*', requireAuth, requireAdmin)
  // Reading masters (GET) is open to any authenticated role so the bookings
  // filter works for employees; managing them (POST/PATCH/DELETE) stays admin-only.
  app.use('/api/masters/*', requireAuth)
  app.use('/api/masters/*', (c, next) =>
    c.req.method === 'GET' ? next() : requireAdmin(c, next),
  )

  app.route('/healthz', healthzRouter)
  app.route('/api/bookings', bookingsRouter)
  app.route('/api/clients', clientsRouter)
  app.route('/api/pricelist', pricelistRouter)
  app.route('/api/masters', mastersRouter)
  app.route('/api/salaries', salariesRouter)
  app.route('/api/analytics', analyticsRouter)

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
