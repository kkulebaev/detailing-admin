import { isSafeRedirect } from './safe-redirect'
import {
  deletePushSubscription,
  fetchPushConfig,
  fetchPushSubscriptionStatus,
  savePushSubscription,
} from './notifications-api'

const SW_URL = '/sw.js'

export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install'

function isIos(): boolean {
  // iPadOS выдает себя за Mac, отличает его только тач.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  )
}

/** На iOS пуши есть только у приложения, добавленного на экран «Домой» (16.4+): во
 * вкладке Safari PushManager просто отсутствует, и без подсказки пользователь не поймет,
 * почему переключателя нет. */
export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return 'ios-needs-install'
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  return supported ? 'supported' : 'unsupported'
}

/** null — на сервере не заданы VAPID-ключи, пуши выключены. */
export async function fetchPushPublicKey(): Promise<string | null> {
  const res = await fetchPushConfig()
  return res.ok ? res.publicKey : null
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default'
}

/** updateViaCache: 'none' — браузер перепроверяет sw.js в обход HTTP-кеша, иначе
 * исправленный воркер доезжал бы до телефонов сутками. */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' })
  } catch {
    // Без воркера не будет только пушей; приложению он не нужен.
  }
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  // getRegistration, а не ready: ready без регистрации не резолвится никогда.
  return navigator.serviceWorker.getRegistration(SW_URL)
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    return (await (await registration())?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false
  const view = new Uint8Array(a)
  return view.every((v, i) => v === b[i])
}

/** Подписан ли этот браузер на сервере за текущим аккаунтом. Браузеру одному верить
 * нельзя: подписку могли перевесить на другой аккаунт или удалить после 410. Ждет
 * пересохранения после входа, иначе профиль, открытый сразу после него, показал бы
 * «выключено» за мгновение до того, как подписка вернулась. */
export async function isPushSubscribed(): Promise<boolean> {
  await pendingSync
  const sub = await currentPushSubscription()
  if (!sub) return false
  const res = await fetchPushSubscriptionStatus(sub.endpoint)
  return res.ok && res.subscribed
}

// Намерение «пуши на этом устройстве» хранится по логину: на общем телефоне вход
// другого человека не должен молча перевесить подписку на него. Логин не секрет, а
// localStorage в приватном режиме может бросать, поэтому каждый доступ под try.
const intentKey = (login: string) => `push-intent:${login}`

export function hasPushIntent(login: string): boolean {
  try {
    return localStorage.getItem(intentKey(login)) === '1'
  } catch {
    return false
  }
}

function setPushIntent(login: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(intentKey(login), '1')
    else localStorage.removeItem(intentKey(login))
  } catch {
    // Без хранилища подписка просто не вернется сама после следующего входа.
  }
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
  const res = await savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
  return res.ok
}

let pendingSync: Promise<void> = Promise.resolve()

/** Возвращает подписку этого устройства аккаунту после входа и на каждом старте
 * приложения: сервер отвязывает ее при выходе, а ее срок кончается вместе с сессией.
 * Только пересохраняет уже существующую подписку (subscribe без жеста iOS не даст) и
 * никогда не спрашивает разрешение. Заодно доносит до сервера endpoint, который
 * браузер сменил сам. Никогда не бросает. */
export function syncPushSubscription(login: string): Promise<void> {
  pendingSync = (async () => {
    try {
      if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
      if (!hasPushIntent(login)) return
      const sub = await currentPushSubscription()
      if (sub) await saveSubscription(sub)
    } catch {
      // Пуши не должны мешать ни входу, ни старту приложения.
    }
  })()
  return pendingSync
}

export type SubscribeResult = 'subscribed' | 'denied' | 'error'

/** Вызывать только из обработчика жеста: iOS дает запросить разрешение только по тапу,
 * поэтому requestPermission идет первым, до любого другого await. */
export async function subscribePush(publicKey: string, login: string): Promise<SubscribeResult> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  try {
    await registerServiceWorker()
    const reg = await navigator.serviceWorker.ready
    const key = base64UrlToBytes(publicKey)
    let sub = await reg.pushManager.getSubscription()
    // После смены VAPID-ключа старая подписка бесполезна: push-сервис отвергнет подпись.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    if (!(await saveSubscription(sub))) return 'error'
    setPushIntent(login, true)
    return 'subscribed'
  } catch {
    return 'error'
  }
}

/** Выход: отвязывает подписку от аккаунта на сервере, пока сессия жива, но оставляет
 * ее браузеру и намерение аккаунта. iOS дает вызвать pushManager.subscribe() только по
 * жесту пользователя, а пересохранить уже существующую подписку можно без него, так что
 * после следующего входа syncPushSubscription вернет пуши без похода в профиль. */
export async function detachPushSubscription(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  await deletePushSubscription(sub.endpoint)
}

/** Переключатель в профиле: снимает подписку и на сервере, и в браузере, и забывает
 * намерение аккаунта. Браузерная отписка выполняется, даже если сервер не ответил или
 * уже не узнает сессию (401): серверная строка тогда умрет на первом 410 от
 * push-сервиса. */
export async function unsubscribePush(login: string): Promise<void> {
  setPushIntent(login, false)
  const sub = await currentPushSubscription()
  if (!sub) return
  try {
    await deletePushSubscription(sub.endpoint)
  } catch {
    // См. выше: локальная отписка важнее.
  }
  try {
    await sub.unsubscribe()
  } catch {
    // Браузер уже забыл подписку.
  }
}

export interface ServiceWorkerMessageHandlers {
  navigate: (link: string) => void
  notification: () => void
}

/** Сообщения от sw.js: тап по пушу при открытом окне и приход нового пуша. */
export function listenServiceWorkerMessages(handlers: ServiceWorkerMessageHandlers): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  const container = navigator.serviceWorker
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data
    if (typeof data !== 'object' || data === null || !('type' in data)) return
    if (data.type === 'navigate' && 'link' in data && typeof data.link === 'string') {
      if (isSafeRedirect(data.link)) handlers.navigate(data.link)
      handlers.notification()
    } else if (data.type === 'notification') {
      handlers.notification()
    }
  }
  container.addEventListener('message', onMessage)
  // Без явного старта очередь сообщений от воркера открывается только после загрузки
  // документа, и сообщение, пришедшее раньше, ждало бы ее.
  container.startMessages()
  return () => container.removeEventListener('message', onMessage)
}

/** Значок на иконке приложения. Не везде поддержан, поэтому молча. */
export function setAppBadge(count: number): void {
  if (!('setAppBadge' in navigator)) return
  const op = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()
  op.catch(() => {})
}
