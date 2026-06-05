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

serve({ fetch: app.fetch, port: env.PORT })

baseLogger.info({ event: 'listening', port: env.PORT }, 'API server listening')
