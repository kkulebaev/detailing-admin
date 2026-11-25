import { createHash } from 'node:crypto'
import {
  sendNotification,
  WebPushError,
  type PushSubscription,
  type RequestOptions,
  type SendResult,
} from 'web-push'
import { env } from '../env.js'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

// То, что читает sw.js. `unread` нужен для setAppBadge: сам SW в API не ходит.
export interface PushPayload {
  title: string
  body: string
  link: string
  tag: string
  unread: number
}

// status — HTTP-код push-сервиса или null, если ответа не было (сеть, таймаут,
// кривые ключи). gone — подписки больше нет, ее надо удалить.
export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; gone: boolean }

type PushSender = (
  subscription: PushSubscription,
  payload: string,
  options: RequestOptions,
) => Promise<SendResult>

let _send: PushSender = sendNotification

/** Только для тестов и e2e — подменяет отправку, чтобы не ходить в сеть. */
export function _setPushSenderForTest(fn: PushSender): void {
  _send = fn
}

// Пуш о вчерашнем переносе только мешает: недоставленное за сутки push-сервис выбросит.
const PUSH_TTL_SECONDS = 24 * 60 * 60
const PUSH_TIMEOUT_MS = 10_000

function vapid() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null
  return { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
}

export function isPushEnabled(): boolean {
  return vapid() !== null
}

/** Публичный ключ для pushManager.subscribe; null — push на сервере не настроен. */
export function pushPublicKey(): string | null {
  return vapid()?.publicKey ?? null
}

/** Topic схлопывает недоставленные повторы на стороне push-сервиса, а tag — уже
 * показанные на устройстве. Topic ограничен 32 символами URL-safe base64, поэтому
 * это хеш, а не сам тип с объектом. */
export function pushTopic(type: string, link: string | null): string {
  return createHash('sha256')
    .update(`${type}|${link ?? ''}`)
    .digest('base64url')
    .slice(0, 32)
}

export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  topic: string,
): Promise<PushSendResult> {
  const details = vapid()
  if (!details) return { ok: false, status: null, gone: false }
  try {
    const res = await _send(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: details,
        TTL: PUSH_TTL_SECONDS,
        topic,
        urgency: 'normal',
        timeout: PUSH_TIMEOUT_MS,
      },
    )
    return { ok: true, status: res.statusCode }
  } catch (err) {
    if (err instanceof WebPushError) {
      return {
        ok: false,
        status: err.statusCode,
        gone: err.statusCode === 404 || err.statusCode === 410,
      }
    }
    return { ok: false, status: null, gone: false }
  }
}
