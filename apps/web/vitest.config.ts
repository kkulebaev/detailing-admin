import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Separate from vite.config.ts so the dev and build config never loads test tooling.
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
    // The default glob would also run Playwright's e2e/*.spec.ts.
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
