import type { Breadcrumb } from '@sentry/hono/node'
import { isPushServiceEndpoint } from '@detailing-admin/shared'

// Токен бота стоит прямо в пути запросов к Bot API, а путь push-эндпоинта и есть
// адрес подписки устройства: ни то ни другое не должно уйти в Sentry.
export function scrubOutgoingUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '[unparsable url]'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[unparsable url]'
  if (isPushServiceEndpoint(url.href)) return url.origin
  return `${url.origin}${url.pathname.replace(/^\/bot[^/]+/, '/bot[Filtered]')}`
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const url = breadcrumb.data?.url
  if (typeof url !== 'string') return breadcrumb
  return { ...breadcrumb, data: { ...breadcrumb.data, url: scrubOutgoingUrl(url) } }
}
