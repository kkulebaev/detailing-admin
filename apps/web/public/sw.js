// Воркер только для Web Push. Ни fetch-хендлера, ни precache: без них браузер ходит
// в сеть как обычно и не может отдать чанки прошлого деплоя из кеша воркера.

// Новая версия воркера вступает в силу сразу, а не после закрытия всех вкладок:
// перехватывать ему нечего, так что подменять старую версию на лету безопасно.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const FALLBACK_LINK = '/notifications'

// Как isSafeRedirect в приложении: «//host» и «/\host» браузер читает как адрес другого
// сайта, поэтому мало того, что ссылка начинается со слеша.
function safeLink(link) {
  return typeof link === 'string' && link[0] === '/' && link[1] !== '/' && link[1] !== '\\'
    ? link
    : FALLBACK_LINK
}

async function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const tasks = [
    self.registration.showNotification(data.title || 'Dazzle Detailing', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: data.tag,
      // Тот же tag заменяет прошлое уведомление молча; новое событие должно звучать.
      renotify: Boolean(data.tag),
      data: { link: safeLink(data.link) },
    }),
    // Открытая вкладка обновляет счетчик сразу, не дожидаясь минутного опроса.
    windowClients().then((list) => {
      for (const client of list) client.postMessage({ type: 'notification' })
    }),
  ]
  if (typeof data.unread === 'number' && 'setAppBadge' in self.navigator) {
    tasks.push(
      (data.unread > 0
        ? self.navigator.setAppBadge(data.unread)
        : self.navigator.clearAppBadge()
      ).catch(() => {}),
    )
  }
  event.waitUntil(Promise.all(tasks))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = safeLink(event.notification.data && event.notification.data.link)
  event.waitUntil(
    (async () => {
      const list = await windowClients()
      const client = list.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        // Навигацию делает роутер приложения: перезагрузка страницы потеряла бы состояние.
        await client.focus()
        client.postMessage({ type: 'navigate', link })
        return
      }
      await self.clients.openWindow(link)
    })(),
  )
})
