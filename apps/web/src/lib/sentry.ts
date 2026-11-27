import type { App } from 'vue'
import * as Sentry from '@sentry/vue'

// В query лежат фильтры и поиск списков (`/bookings?search=+7…`), то есть телефоны и
// имена клиентов: в Sentry уходит только путь.
export function stripQuery(raw: string): string {
  const cut = raw.search(/[?#]/)
  return cut === -1 ? raw : raw.slice(0, cut)
}

function stripBreadcrumbUrls(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = breadcrumb.data
  if (!data) return breadcrumb
  const next = { ...data }
  for (const key of ['url', 'from', 'to'] as const) {
    if (typeof next[key] === 'string') next[key] = stripQuery(next[key])
  }
  return { ...breadcrumb, data: next }
}

export function initSentry(app: App) {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  // DSN задается только при сборке для Railway, поэтому dev и тесты ничего не шлют.
  if (!dsn) return
  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.MODE,
    // Пропсы компонентов несут клиентов, записи и суммы.
    attachProps: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: stripBreadcrumbUrls,
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripQuery(event.request.url)
      return event
    },
  })
}
