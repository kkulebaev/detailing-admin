import { vi } from 'vitest'

// Заранее задаем минимум обязательных env-переменных, чтобы импорт src/env.ts
// в env.test.ts (который НЕ мокает модуль) не бросал исключение.
// Все остальные тестовые файлы мокают src/env.js целиком и сюда не попадают.
process.env.SPREADSHEET_ID ??= 'test-sheet-id'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ??= Buffer.from('{}').toString('base64')
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
process.env.TELEGRAM_BOT_TOKEN ??= 'test-bot-token'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-chars-long'
process.env.LOG_LEVEL ??= 'silent'
// Poller из настоящего env.ts забирал бы апдейты бота из .env разработчика.
process.env.TELEGRAM_POLLING = 'false'

// VAPID из окружения разработчика (или CI) включил бы push в тестах, которые читают
// настоящий env.ts.
delete process.env.VAPID_PUBLIC_KEY
delete process.env.VAPID_PRIVATE_KEY
delete process.env.VAPID_SUBJECT
// С DSN разработчика тесты, импортирующие instrument.ts, слали бы события в Sentry.
delete process.env.SENTRY_DSN

// Настоящая отправка ушла бы в сеть: любой вызов мимо _setPushSenderForTest падает.
vi.mock('web-push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('web-push')>()),
  sendNotification: vi.fn(() => {
    throw new Error('Real web-push sendNotification called from a test')
  }),
}))
