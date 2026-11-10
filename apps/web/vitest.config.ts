import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Отдельно от vite.config.ts, чтобы конфиг dev и сборки никогда не грузил тестовый инструментарий.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@detailing-admin/shared': path.resolve(
        import.meta.dirname,
        '../../packages/shared/src/index.ts',
      ),
    },
  },
  test: {
    // Glob по умолчанию запустил бы еще и e2e/*.spec.ts от Playwright.
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
})
