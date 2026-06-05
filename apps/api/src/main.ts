import { serve } from '@hono/node-server'
import { env } from './env.js'
import { baseLogger } from './log.js'
import { init } from './boot.js'
import { createApp } from './server.js'

// Run boot init (header verification) before binding the listener.
// init() NEVER calls process.exit — even on mismatch or creds error,
// it sets bootState and returns so the listener still binds.
await init()

const app = createApp()

const server = serve({ fetch: app.fetch, port: env.PORT })

baseLogger.info({ event: 'listening', port: env.PORT }, 'API server listening')

// Graceful shutdown: without this, Node as PID 1 ignores SIGTERM, Railway
// waits the full grace period and SIGKILLs — which can sever an in-flight
// Sheets append mid-write and leave an orphan row or a duplicate on client retry.
const shutdown = (signal: string) => {
  baseLogger.info({ event: 'shutdown', signal }, 'received shutdown signal')
  server.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
