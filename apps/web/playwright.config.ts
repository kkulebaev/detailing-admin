import { defineConfig, devices } from '@playwright/test'

// Собственные порты, чтобы прогон уживался с `pnpm dev` на 5173/3000.
const WEB_URL = 'http://localhost:5174'
const API_URL = 'http://localhost:3100'

export default defineConfig({
  testDir: './e2e',
  // Спеки делят один процесс API и одну базу.
  workers: 1,
  reporter: 'list',
  use: {
    // Приложение mobile-first, поэтому проверяется именно основная раскладка.
    ...devices['Pixel 7'],
    baseURL: WEB_URL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @detailing-admin/api e2e:server',
      url: `${API_URL}/healthz`,
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec vite --port 5174 --strictPort',
      url: WEB_URL,
      // Vite пересылает сюда каждый console.warn браузера, и отчет о тестах в них тонет.
      stderr: 'ignore',
      env: { VITE_API_PROXY_TARGET: API_URL },
    },
  ],
})
