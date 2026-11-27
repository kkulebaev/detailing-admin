import * as Sentry from '@sentry/hono/node'
import { env } from './env.js'
import { scrubBreadcrumb } from './sentry-scrub.js'

// Без DSN (локально, в тестах, в e2e) SDK не инициализируется вовсе.
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? 'development',
    release: env.RAILWAY_GIT_COMMIT_SHA,
    // По умолчанию v11 шлет тела запросов, query, cookie и локальные переменные кадров, а
    // в них телефоны и имена клиентов, пароли при входе и JWT сессии. Оставляем только то,
    // что нужно для разбора ошибки.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'content-type'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: scrubBreadcrumb,
  })
}
