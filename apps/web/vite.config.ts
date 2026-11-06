import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Two distinct ports: Vite dev server (frontend) on 5173, the API (apps/api) on
// 3000. The browser talks to 5173 and Vite forwards /api/* to 3000 — don't
// unify these or the proxy loops back into itself.
const DEV_SERVER_PORT = 5173
const DEFAULT_API_PROXY_TARGET = 'http://localhost:3000'

export default defineConfig(({ mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Dev server: default to the local API, overridable to point the /api proxy
  // at a remote backend (e.g. VITE_API_PROXY_TARGET=https://…railway.app) without
  // touching the client.
  const devProxyTarget = env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  if (devProxyTarget !== DEFAULT_API_PROXY_TARGET) {
    console.log(`[vite] dev /api proxy → ${devProxyTarget}`)
  }

  // Prod serves the built SPA via `vite preview` inside the web container, which
  // reverse-proxies /api to the API service so the auth cookie stays first-party
  // (SameSite=Lax) — see .omc/plans/auth-rbac-plan.md §3-bis. Crucially there is
  // NO localhost fallback here: nothing listens on :3000 in that container, and
  // silently proxying there is exactly what surfaced as edge 502s. Require the
  // target explicitly and fail at startup so a missing var lands in the deploy
  // logs instead of every /api call 502-ing at runtime.
  const previewProxyTarget = env.VITE_API_PROXY_TARGET
  if (isPreview && !previewProxyTarget) {
    throw new Error(
      '[vite preview] VITE_API_PROXY_TARGET is required — point it at the API service ' +
        'internal URL (e.g. http://detailing-admin-api.railway.internal:PORT). Without it ' +
        '/api cannot be proxied and every API request 502s.',
    )
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
    preview: {
      // Vite ≥5 blocks unknown Host headers on preview (DNS-rebinding guard).
      // Railway's healthcheck hits us by container IP, not a predictable
      // hostname, so suffix allowlists never match — open the gate explicitly.
      allowedHosts: true,
      // Explicit rather than inheriting server.proxy: the two have different
      // correct targets (local API vs the deployed API service), and the
      // inherited default silently pointed prod at localhost:3000.
      ...(previewProxyTarget
        ? { proxy: { '/api': { target: previewProxyTarget, changeOrigin: true } } }
        : {}),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@detailing-admin/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
  }
})
