// Настоящий API на настоящем Postgres для Playwright: подменены только Sheets и Telegram.
// Все переменные задаются здесь, а не читаются из `.env`, поэтому у прогона нет
// учётных данных, способных дотянуться до настоящей таблицы, бота или базы.
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import { EXPECTED_HEADERS } from '@detailing-admin/shared'

const PORT = 3100
const POSTGRES_URL = 'postgres://detailing:detailing@localhost:5432'
const E2E_DATABASE = 'detailing_e2e'

Object.assign(process.env, {
  PORT: String(PORT),
  DATABASE_URL: `${POSTGRES_URL}/${E2E_DATABASE}`,
  SPREADSHEET_ID: 'e2e-spreadsheet',
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
  TELEGRAM_BOT_TOKEN: 'e2e-bot-token',
  JWT_SECRET: 'e2e-jwt-secret-at-least-32-chars-long',
  WEB_ORIGIN: 'http://localhost:5174',
  LOG_LEVEL: 'warn',
})

const admin = postgres(`${POSTGRES_URL}/postgres`, { max: 1, onnotice: () => {} })
await admin.unsafe(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`)
await admin.unsafe(`CREATE DATABASE ${E2E_DATABASE}`)
await admin.end()

// Импортируется только сейчас: `env.ts` проверяет process.env при импорте.
const { _setClientForTest } = await import('../src/sheets.js')
const { _setFetchForTest } = await import('../src/telegram.js')
const { getBootState, init, isDbReady } = await import('../src/boot.js')
const { createApp } = await import('../src/server.js')
const { hashPassword } = await import('../src/auth/password.js')
const { createUser } = await import('../src/db/users.js')
const { createMaster } = await import('../src/db/masters.js')
const { createSection, createService } = await import('../src/db/pricelist.js')

const sheetRows: unknown[][] = []
const telegramMessages: { chat_id: string; text: string }[] = []

const fakeSheets = {
  spreadsheets: {
    values: {
      get: async () => ({ data: { values: [[...EXPECTED_HEADERS]] } }),
      append: async ({ requestBody }: { requestBody: { values: unknown[][] } }) => {
        sheetRows.push(...requestBody.values)
        // +1 за строку заголовка, которую настоящая таблица держит в строке 1.
        const row = sheetRows.length + 1
        return { status: 200, data: { updates: { updatedRange: `'Запись 2026'!A${row}:K${row}` } } }
      },
    },
  },
}
_setClientForTest(fakeSheets as unknown as Parameters<typeof _setClientForTest>[0])

_setFetchForTest(async (_url, init) => {
  telegramMessages.push(JSON.parse(String(init?.body)))
  return Response.json({ ok: true })
})

await init()
if (getBootState() !== 'ok' || !isDbReady()) {
  throw new Error(`E2E API failed to boot: state=${getBootState()}, dbReady=${isDbReady()}`)
}

const passwordHash = await hashPassword('e2e-password-123')
const account = (login: string, role: 'admin' | 'booker' | 'employee') =>
  createUser({ login, passwordHash, role, firstName: '', lastName: '' })

await account('e2e-admin', 'admin')
await account('e2e-booker', 'booker')
const employee = await account('e2e-employee', 'employee')

await createMaster({
  name: 'Мастер Пётр',
  canBeResponsible: true,
  paidSalary: true,
  telegramId: '100',
  userId: employee.id,
})

const section = await createSection('Кузов')
await createService({
  sectionId: section.id,
  name: 'Полировка кузова',
  priceClass1Min: 5000,
  priceClass2Min: 6000,
  priceClass3Min: 7000,
  priceClass4Min: 8000,
})

const app = createApp()
// Даёт спекам проверить, что дошло до фейков. Есть только в этой точке входа.
app.get('/__e2e/state', (c) => c.json({ sheetRows, telegramMessages }))

serve({ fetch: app.fetch, port: PORT })
