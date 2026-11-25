import { describe, expect, it, vi } from 'vitest'

// Тот же файл, что отдает сервер: public/ раздается из корня и в браузере прогона.
const swSource = await (await fetch('/sw.js')).text()

type Listener = (event: unknown) => void

// sw.js выполняется на фейковом self: настоящий воркер в браузере прогона не нужен.
function loadWorker(windows: { url: string }[] = []) {
  const listeners = new Map<string, Listener>()
  const openWindow = vi.fn()
  const clients = windows.map((w) => ({
    url: w.url,
    focus: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
  }))
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    location: { origin: 'https://app.example' },
    navigator: {},
    clients: { matchAll: vi.fn().mockResolvedValue(clients), openWindow, claim: vi.fn() },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn(),
  }
  new Function('self', swSource)(self)
  async function click(link: unknown) {
    let done: Promise<unknown> = Promise.resolve()
    listeners.get('notificationclick')!({
      notification: { close: vi.fn(), data: { link } },
      waitUntil: (p: Promise<unknown>) => (done = p),
    })
    await done
  }
  return { click, openWindow, clients }
}

describe('sw.js — тап по пушу', () => {
  it('без открытого окна открывает ссылку', async () => {
    const sw = loadWorker()
    await sw.click('/bookings?booking=bk1')
    expect(sw.openWindow).toHaveBeenCalledWith('/bookings?booking=bk1')
  })

  it('с открытым окном фокусирует его и передает навигацию', async () => {
    const sw = loadWorker([{ url: 'https://app.example/login' }])
    await sw.click('/schedule')
    expect(sw.clients[0]!.focus).toHaveBeenCalled()
    expect(sw.clients[0]!.postMessage).toHaveBeenCalledWith({ type: 'navigate', link: '/schedule' })
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 42])(
    'чужую ссылку %s заменяет лентой',
    async (link) => {
      const sw = loadWorker()
      await sw.click(link)
      expect(sw.openWindow).toHaveBeenCalledWith('/notifications')
    },
  )
})
