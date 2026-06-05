// Pre-seed minimum required env vars so that importing src/env.ts
// in env.test.ts (which does NOT mock the module) does not throw.
// All other test files mock src/env.js entirely and never hit this code path.
process.env.SPREADSHEET_ID ??= 'test-sheet-id'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ??= Buffer.from('{}').toString('base64')
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
process.env.LOG_LEVEL ??= 'silent'
