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
import meRouter from './routes/me.js'
import usersRouter from './routes/users.js'
import {
  requireAuth,
  requireAdmin,
  requireBookingAccess,
  requireBookingEdit,
} from './auth/middleware.js'

const BOOKINGS_ADMIN_ONLY = /^\/api\/bookings\/(deleted|[^/]+\/(history|restore))$/

export function createApp() {
  // Собирается императивно, а не цепочкой, чтобы тип OpenAPIHono пережил
  // `.notFound()` (в цепочке он расширяется до обычного Hono, который теряет
  // `.doc()`). Веб-клиент генерирует orval по OpenAPI-документу, а не
  // `hc<AppType>`, так что вывод AppType из цепочки здесь не важен.
  const app = new OpenAPIHono()

  app.use(
    '/api/*',
    cors({
      origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
      // credentials:true, чтобы браузер прикладывал и принимал cookie авторизации.
      // Заголовок Allow-Credentials уходит даже с 401 (CORS идет до auth), поэтому
      // SPA может прочитать отклоненный ответ. При first-party топологии (план, §3-bis)
      // это перестраховка, а не несущая конструкция.
      credentials: true,
      allowMethods: ['POST', 'GET', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  // Эшелонированная защита: тело любого /api/* ограничено 64 КБ (самая большая
  // легитимная запись ~4 КБ; при превышении Hono отдает стандартный 413).
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }))

  // Эндпоинты авторизации остаются вне guard'ов: login/logout/me публичны по замыслу,
  // change-password защищает себя сам. Регистрируются до guard'ов, чтобы
  // wildcard'ы ниже их не перекрывали.
  app.route('/api/auth', authRouter)

  // Все остальное под /api — только для админа. При матчинге Hono wildcard `/*` покрывает
  // и голый путь коллекции (POST /api/bookings), а stateless requireAuth сохраняет
  // независимость записи от Postgres.
  // Список записей (GET) доступен любой авторизованной роли — обработчик скрывает
  // суммы по роли. POST — это форма записи; правка, удаление и готовность
  // подчиняются `canEditBookings`.
  // Журнал и корзина показывают суммы и чужие действия, поэтому только для админа,
  // хотя по методу (GET, POST) попали бы в открытые ветки ниже.
  app.use('/api/bookings/*', requireAuth)
  app.use('/api/bookings/*', (c, next) => {
    if (BOOKINGS_ADMIN_ONLY.test(c.req.path)) return requireAdmin(c, next)
    if (c.req.method === 'GET') return next()
    return c.req.method === 'POST' ? requireBookingAccess(c, next) : requireBookingEdit(c, next)
  })
  // Автозаполнение формы — единственная часть API клиентов, доступная booker'у:
  // список, карточка и экспорт остаются только для админа.
  app.use('/api/clients/*', requireAuth, (c, next) =>
    c.req.method === 'GET' && c.req.path === '/api/clients/lookup'
      ? requireBookingAccess(c, next)
      : requireAdmin(c, next),
  )
  // Форма берет цены услуг из прайса; редактировать его может только админ.
  app.use('/api/pricelist/*', requireAuth, (c, next) =>
    c.req.method === 'GET' ? requireBookingAccess(c, next) : requireAdmin(c, next),
  )
  app.use('/api/salaries/*', requireAuth, requireAdmin)
  // Аналитика показывает суммы выручки — только для админа, как и прочие чувствительные чтения.
  app.use('/api/analytics/*', requireAuth, requireAdmin)
  // Аккаунты перечисляются только для привязки к мастерам на админской странице «Мастера».
  app.use('/api/users/*', requireAuth, requireAdmin)
  // Самообслуживание для любой роли: обработчики ограничивают каждое чтение и запись
  // мастером, привязанным к аккаунту сессии.
  app.use('/api/me/*', requireAuth)
  // Чтение мастеров (GET) открыто любой авторизованной роли, чтобы фильтр записей работал
  // у сотрудников; управление ими (POST/PATCH/DELETE) остается только для админа.
  app.use('/api/masters/*', requireAuth)
  app.use('/api/masters/*', (c, next) => (c.req.method === 'GET' ? next() : requireAdmin(c, next)))

  app.route('/healthz', healthzRouter)
  app.route('/api/bookings', bookingsRouter)
  app.route('/api/clients', clientsRouter)
  app.route('/api/pricelist', pricelistRouter)
  app.route('/api/masters', mastersRouter)
  app.route('/api/salaries', salariesRouter)
  app.route('/api/analytics', analyticsRouter)
  app.route('/api/users', usersRouter)
  app.route('/api/me', meRouter)

  app.notFound((c) => c.json({ ok: false as const, error: 'not_found' as const }, 404))

  // OpenAPI-документ, отдается по `/openapi.json`. По нему orval генерирует
  // веб-клиент; еще удобен для ручного просмотра в dev.
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
