// Настоящий API на настоящем Postgres для Playwright: подменены только Sheets и Telegram.
// Все переменные задаются здесь, а не читаются из `.env`, поэтому у прогона нет
// учетных данных, способных дотянуться до настоящей таблицы, бота или базы.
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import { generateVAPIDKeys } from 'web-push'
import { EXPECTED_HEADERS } from '@detailing-admin/shared'

const PORT = 3100
const POSTGRES_URL = 'postgres://detailing:detailing@localhost:5432'
const E2E_DATABASE = 'detailing_e2e'
// Ключи на каждый запуск: с ними push включен, а отправку все равно ловит фейк ниже.
const vapidKeys = generateVAPIDKeys()

Object.assign(process.env, {
  PORT: String(PORT),
  DATABASE_URL: `${POSTGRES_URL}/${E2E_DATABASE}`,
  SPREADSHEET_ID: 'e2e-spreadsheet',
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
  TELEGRAM_BOT_TOKEN: 'e2e-bot-token',
  JWT_SECRET: 'e2e-jwt-secret-at-least-32-chars-long',
  WEB_ORIGIN: 'http://localhost:5174',
  LOG_LEVEL: 'warn',
  VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  VAPID_PRIVATE_KEY: vapidKeys.privateKey,
  VAPID_SUBJECT: 'mailto:e2e@example.com',
  // Апдейты бота имитирует POST /__e2e/telegram/update, настоящий getUpdates не нужен.
  TELEGRAM_POLLING: 'false',
})

const admin = postgres(`${POSTGRES_URL}/postgres`, { max: 1, onnotice: () => {} })
await admin.unsafe(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`)
await admin.unsafe(`CREATE DATABASE ${E2E_DATABASE}`)
await admin.end()

// Импортируется только сейчас: `env.ts` проверяет process.env при импорте.
const { _setClientForTest } = await import('../src/sheets.js')
const { _setFetchForTest } = await import('../src/telegram.js')
const { _setPushSenderForTest } = await import('../src/notifications/web-push.js')
const { _setBotUsernameForTest, handleTelegramUpdate } =
  await import('../src/notifications/telegram-poller.js')
const { getBootState, init, isDbReady } = await import('../src/boot.js')
const { createApp } = await import('../src/server.js')
const { hashPassword } = await import('../src/auth/password.js')
const { createUser } = await import('../src/db/users.js')
const { createMaster } = await import('../src/db/masters.js')
const { createSection, createService } = await import('../src/db/pricelist.js')

const sheetRows: unknown[][] = []
const telegramMessages: { chat_id: string; text: string }[] = []
const pushMessages: { endpoint: string; payload: unknown }[] = []

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

_setFetchForTest(async (url, init) => {
  if (String(url).endsWith('/sendMessage')) telegramMessages.push(JSON.parse(String(init?.body)))
  return Response.json({ ok: true, result: true })
})
// Без poller'а username брать неоткуда, а с ним профиль показывает «Подключить».
_setBotUsernameForTest('dazzle_e2e_bot')

_setPushSenderForTest(async (subscription, payload) => {
  pushMessages.push({ endpoint: subscription.endpoint, payload: JSON.parse(String(payload)) })
  return { statusCode: 201, body: '', headers: {} }
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
  name: 'Мастер Петр',
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
await createService({
  sectionId: section.id,
  name: 'Химчистка салона',
  priceClass1Min: 3000,
  priceClass2Min: 4000,
  priceClass3Min: 5000,
  priceClass4Min: 6000,
})

const app = createApp()
// Дает спекам проверить, что дошло до фейков. Есть только в этой точке входа.
app.get('/__e2e/state', (c) => c.json({ sheetRows, telegramMessages, pushMessages }))
// Сообщение пользователя боту, как его отдал бы getUpdates: проходит тот же обработчик.
let updateId = 0
app.post('/__e2e/telegram/update', async (c) => {
  const { chatId, text } = await c.req.json<{ chatId: number; text: string }>()
  await handleTelegramUpdate({
    update_id: ++updateId,
    message: { text, chat: { id: chatId, type: 'private' } },
  })
  return c.json({ ok: true })
})

serve({ fetch: app.fetch, port: PORT })
