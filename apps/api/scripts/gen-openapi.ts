// Generates the OpenAPI 3.0 document and writes it to apps/web/openapi.json.
// orval reads that file to generate the typed web client. Keep this script
// pure — it only walks the route tree, no Sheets/DB init runs.
//
// `env.ts` validates required env vars at module load. The route tree imports
// it transitively, so we stamp safe placeholders BEFORE the dynamic imports;
// this script never instantiates clients, so the placeholders are inert.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, '../../web/openapi.json')

const app = new OpenAPIHono()
  .route('/healthz', healthzRouter)
  .route('/api/auth', authRouter)
  .route('/api/bookings', bookingsRouter)
  .route('/api/clients', clientsRouter)
  .route('/api/pricelist', pricelistRouter)
  .route('/api/masters', mastersRouter)
  .route('/api/salaries', salariesRouter)

const doc = app.getOpenAPIDocument({
  openapi: '3.0.0',
  info: {
    version: '0.0.1',
    title: 'Detailing Admin API',
    description: 'Internal API for the detailing booking form and admin panel.',
  },
})

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2))
console.log(`OpenAPI document written: ${OUT_PATH}`)
