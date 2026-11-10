// Заранее задаём минимум обязательных env-переменных, чтобы импорт src/env.ts
// в env.test.ts (который НЕ мокает модуль) не бросал исключение.
// Все остальные тестовые файлы мокают src/env.js целиком и сюда не попадают.
process.env.SPREADSHEET_ID ??= 'test-sheet-id'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ??= Buffer.from('{}').toString('base64')
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
process.env.TELEGRAM_BOT_TOKEN ??= 'test-bot-token'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-chars-long'
process.env.LOG_LEVEL ??= 'silent'
