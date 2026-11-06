import { defineConfig, devices } from '@playwright/test'

// Ports of their own, so a run coexists with `pnpm dev` on 5173/3000.
const WEB_URL = 'http://localhost:5174'
const API_URL = 'http://localhost:3100'

export default defineConfig({
  testDir: './e2e',
  // Specs share one API process and one database.
  workers: 1,
  reporter: 'list',
  use: {
    // The app is mobile-first, so its primary layout is what gets exercised.
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
      // Vite relays every browser console.warn here, which buries the test report.
      stderr: 'ignore',
      env: { VITE_API_PROXY_TARGET: API_URL },
    },
  ],
})
