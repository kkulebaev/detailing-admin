import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Vite ≥5's preview blocks unknown Host headers by default (DNS rebinding
  // guard) — Railway's internal healthcheck hits us by container hostname,
  // which is not localhost, and gets 403. Allow Railway public + private
  // domains explicitly; anything else still 403s.
  preview: {
    allowedHosts: ['.up.railway.app', '.railway.internal'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@detailing-admin/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
