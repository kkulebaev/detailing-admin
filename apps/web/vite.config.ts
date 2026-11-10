import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Два разных порта: dev-сервер Vite (фронтенд) на 5173, API (apps/api) на 3000.
// Браузер обращается к 5173, а Vite пересылает /api/* на 3000 — не объединяйте их,
// иначе прокси зациклится сам на себя.
const DEV_SERVER_PORT = 5173
const DEFAULT_API_PROXY_TARGET = 'http://localhost:3000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Dev-сервер: по умолчанию локальный API; можно переопределить, чтобы /api-прокси
  // смотрел на удалённый бэкенд (например, VITE_API_PROXY_TARGET=https://…railway.app),
  // не трогая клиент.
  const devProxyTarget = env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  if (devProxyTarget !== DEFAULT_API_PROXY_TARGET) {
    console.log(`[vite] dev /api proxy → ${devProxyTarget}`)
  }

  return {
    plugins: [vue(), tailwindcss()],
    server: {
      port: DEV_SERVER_PORT,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@detailing-admin/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
  }
})
