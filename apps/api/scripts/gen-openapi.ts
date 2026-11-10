// Генерирует документ OpenAPI 3.0 и пишет его в apps/web/openapi.json.
// orval читает этот файл, чтобы сгенерировать типизированный веб-клиент. Скрипт
// должен оставаться чистым — он только обходит дерево роутов, инициализации Sheets/БД нет.
//
// `env.ts` проверяет обязательные переменные окружения при загрузке модуля. Дерево
// роутов импортирует его транзитивно, поэтому мы проставляем безопасные заглушки ДО
// динамических импортов; скрипт никогда не создает клиентов, так что заглушки инертны.
// Под vitest это тоже безвредно — test/setup.ts уже задает те же переменные.
//
// buildOpenApiDocument() экспортируется, чтобы openapi-drift.test.ts мог собрать
// документ в памяти и сравнить его с закоммиченным openapi.json. Поэтому запись
// спрятана за проверкой main: без нее импорт модуля из теста перезаписал бы тот самый
// файл, с которым тест собирается сравнивать, и забытая регенерация никогда бы не
// покраснела.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ??= Buffer.from('{}').toString('base64')
process.env.DATABASE_URL ??= 'postgres://placeholder@localhost:5432/placeholder'
process.env.TELEGRAM_BOT_TOKEN ??= 'placeholder'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.SPREADSHEET_ID ??= 'placeholder'
process.env.SHEET_NAME ??= 'Запись 2026'
process.env.WEB_ORIGIN ??= 'http://localhost:5173'
process.env.LOG_LEVEL ??= 'silent'

const { OpenAPIHono } = await import('@hono/zod-openapi')
const { default: healthzRouter } = await import('../src/routes/healthz.js')
const { default: authRouter } = await import('../src/routes/auth.js')
const { default: bookingsRouter } = await import('../src/routes/bookings.js')
const { default: clientsRouter } = await import('../src/routes/clients.js')
const { default: pricelistRouter } = await import('../src/routes/pricelist.js')
const { default: mastersRouter } = await import('../src/routes/masters.js')
const { default: salariesRouter } = await import('../src/routes/salaries.js')
const { default: analyticsRouter } = await import('../src/routes/analytics.js')
const { default: usersRouter } = await import('../src/routes/users.js')
const { default: meRouter } = await import('../src/routes/me.js')

const __dirname = dirname(fileURLToPath(import.meta.url))

export const OUT_PATH = resolve(__dirname, '../../web/openapi.json')

// Реестр роутеров намеренно продублирован с server.ts — новый роут нужно
// подключить в обоих местах. Свести их в один источник — задача на потом.
export function buildOpenApiDocument() {
  const app = new OpenAPIHono()
    .route('/healthz', healthzRouter)
    .route('/api/auth', authRouter)
    .route('/api/bookings', bookingsRouter)
    .route('/api/clients', clientsRouter)
    .route('/api/pricelist', pricelistRouter)
    .route('/api/masters', mastersRouter)
    .route('/api/salaries', salariesRouter)
    .route('/api/analytics', analyticsRouter)
    .route('/api/users', usersRouter)
    .route('/api/me', meRouter)

  return app.getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
      version: '0.0.1',
      title: 'Detailing Admin API',
      description: 'Internal API for the detailing booking form and admin panel.',
    },
  })
}

// argv[1] отсутствует под `node --eval` и в некоторых встроенных раннерах; проверяем
// его до pathToFileURL, который бросает исключение на undefined.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(buildOpenApiDocument(), null, 2))
  console.log(`OpenAPI document written: ${OUT_PATH}`)
}
