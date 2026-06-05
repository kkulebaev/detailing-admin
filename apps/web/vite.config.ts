import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Two distinct ports: Vite dev server (frontend) listens on 5173, the API
// (apps/api) listens on 3000. The browser talks to 5173, and Vite forwards
// /api/* to 3000 — don't unify these or the proxy will loop back into itself.
const DEV_SERVER_PORT = 5173
const DEFAULT_API_PROXY_TARGET = 'http://localhost:3000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Override via .env.local (e.g. VITE_API_PROXY_TARGET=https://...railway.app)
  // to point the dev `/api` proxy at a remote backend without touching the client.
  const proxyTarget = env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  if (proxyTarget !== DEFAULT_API_PROXY_TARGET) {
    console.log(`[vite] /api proxy → ${proxyTarget}`)
  }

  return {
    plugins: [vue(), tailwindcss()],
    server: {
      port: DEV_SERVER_PORT,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    // Vite ≥5's preview blocks unknown Host headers by default (DNS rebinding
    // guard). Railway's internal healthcheck hits us by container IP, not by
    // any predictable hostname, so suffix allowlists do not match — open the
    // gate explicitly. Safe here: the service has no auth surface and Railway
    // already proxies it publicly.
    preview: {
      allowedHosts: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@detailing-admin/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
  }
})
