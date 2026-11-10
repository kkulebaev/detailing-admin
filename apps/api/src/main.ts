import { serve } from '@hono/node-server'
import { env } from './env.js'
import { baseLogger } from './log.js'
import { init } from './boot.js'
import { createApp } from './server.js'

// Запускаем инициализацию (проверку заголовков) до того, как поднять listener.
// init() НИКОГДА не вызывает process.exit — даже при несовпадении или ошибке учетных
// данных он выставляет bootState и возвращается, чтобы listener все равно поднялся.
await init()

const app = createApp()

const server = serve({ fetch: app.fetch, port: env.PORT })

baseLogger.info({ event: 'listening', port: env.PORT }, 'API server listening')

// Graceful shutdown: без него Node в роли PID 1 игнорирует SIGTERM, Railway ждет
// весь grace period и шлет SIGKILL — это может оборвать идущий append в Sheets посреди
// записи и оставить осиротевшую строку или дубль при повторе клиента.
const shutdown = (signal: string) => {
  baseLogger.info({ event: 'shutdown', signal }, 'received shutdown signal')
  server.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
