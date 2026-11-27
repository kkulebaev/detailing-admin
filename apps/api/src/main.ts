// Первым: SDK должен подняться раньше, чем остальные модули начнут работу.
import './instrument.js'
import { serve } from '@hono/node-server'
import { sentry } from '@sentry/hono/node'
import { env } from './env.js'
import { baseLogger } from './log.js'
import { init, isDbReady } from './boot.js'
import { createApp } from './server.js'
import { startNotificationsCleanup } from './notifications/cleanup.js'
import { drainDeliveries, startDeliverySweeper } from './notifications/deliver.js'
import { startTelegramPoller } from './notifications/telegram-poller.js'

// Запускаем инициализацию (проверку заголовков) до того, как поднять listener.
// init() НИКОГДА не вызывает process.exit — даже при несовпадении или ошибке учетных
// данных он выставляет bootState и возвращается, чтобы listener все равно поднялся.
await init()

const app = createApp((a) => {
  if (env.SENTRY_DSN) a.use(sentry(a))
})

const server = serve({ fetch: app.fetch, port: env.PORT })

baseLogger.info({ event: 'listening', port: env.PORT }, 'API server listening')

startNotificationsCleanup()
const sweeper = startDeliverySweeper()
// Без await: listener не ждет сеть до Telegram. Без базы привязку по /start некуда
// записать, а включенный polling забрал бы апдейты у второго контейнера.
const poller = env.TELEGRAM_POLLING && isDbReady() ? startTelegramPoller() : null

// Сколько ждать пуши, ушедшие после последних ответов: недосланное досылает sweeper
// после рестарта, но только в пределах 15 минут, а Railway дает на остановку немного.
const DRAIN_DELIVERIES_MS = 3000

// Graceful shutdown: без него Node в роли PID 1 игнорирует SIGTERM, Railway ждет
// весь grace period и шлет SIGKILL — это может оборвать идущий append в Sheets посреди
// записи и оставить осиротевшую строку или дубль при повторе клиента.
const shutdown = (signal: string) => {
  baseLogger.info({ event: 'shutdown', signal }, 'received shutdown signal')
  clearInterval(sweeper)
  // Poller первым: оборванный getUpdates освобождает бота для нового контейнера, а он
  // ждет только 409 и backoff.
  void (poller?.stop() ?? Promise.resolve()).finally(() => {
    server.close(() => {
      void drainDeliveries(DRAIN_DELIVERIES_MS).finally(() => process.exit(0))
    })
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
