import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Two distinct ports: Vite dev server (frontend) on 5173, the API (apps/api) on
// 3000. The browser talks to 5173 and Vite forwards /api/* to 3000 — don't
// unify these or the proxy loops back into itself.
const DEV_SERVER_PORT = 5173
const DEFAULT_API_PROXY_TARGET = 'http://localhost:3000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Dev server: default to the local API, overridable to point the /api proxy
  // at a remote backend (e.g. VITE_API_PROXY_TARGET=https://…railway.app) without
  // touching the client.
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
