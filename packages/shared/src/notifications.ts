import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

export const NOTIFICATION_TYPES = [
  'booking.assigned',
  'booking.changed',
  'booking.unassigned',
  'schedule_request.created',
  'schedule_request.decided',
  'payout.changed',
  'work_hours.changed',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_CHANNEL_NAMES = ['feed', 'push', 'telegram'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_NAMES)[number]

// Политика каналов в одном месте. События по записям не идут в Telegram, пока там
// работает старый флажок «Уведомить», иначе мастер получал бы дубль; когда его вольют
// в эту систему, достаточно дописать сюда 'telegram'.
export const NOTIFICATION_CHANNELS: Record<NotificationType, readonly NotificationChannel[]> = {
  'booking.assigned': ['feed', 'push'],
  'booking.changed': ['feed', 'push'],
  'booking.unassigned': ['feed', 'push'],
  'schedule_request.created': ['feed', 'push', 'telegram'],
  'schedule_request.decided': ['feed', 'push', 'telegram'],
  'payout.changed': ['feed', 'push', 'telegram'],
  'work_hours.changed': ['feed', 'push', 'telegram'],
}

export const NOTIFICATIONS_PAGE_SIZE = 30
export const NOTIFICATIONS_MAX_LIMIT = 100
// Лента не архив: старые уведомления удаляются, история живет в журнале и зарплатах.
export const NOTIFICATION_RETENTION_DAYS = 90

export const notificationSchema = z.object({
  id: z.number().int(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  // Путь роутера; null, если открывать нечего.
  link: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})

export type Notification = z.infer<typeof notificationSchema>

export const notificationsListOkSchema = z.object({
  ok: z.literal(true),
  items: z.array(notificationSchema),
  hasMore: z.boolean(),
  unreadCount: z.number().int(),
})

export type NotificationsListOk = z.infer<typeof notificationsListOkSchema>

export const notificationsListResponseSchema = z.union([
  notificationsListOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const notificationsUnreadOkSchema = z.object({
  ok: z.literal(true),
  unreadCount: z.number().int(),
})

export const notificationsUnreadResponseSchema = z.union([
  notificationsUnreadOkSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// ── Web Push ────────────────────────────────────────────────────────────────

export const pushConfigOkSchema = z.object({
  ok: z.literal(true),
  // null — VAPID на сервере не настроен, пуши выключены.
  publicKey: z.string().nullable(),
})

export const pushConfigResponseSchema = z.union([pushConfigOkSchema, internalErrorSchema])

// Сервер сам ходит POST-ом на endpoint, поэтому произвольный адрес превратил бы подписку
// в способ дергать внутренние сервисы (SSRF). Пускаем только push-сервисы браузеров:
// точный хост или его поддомен (сравнение через точку, чтобы evilpush.apple.com не прошел).
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
] as const

export function isPushServiceEndpoint(endpoint: string): boolean {
  let host: string
  try {
    host = new URL(endpoint).hostname.toLowerCase()
  } catch {
    return false
  }
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const pushEndpointSchema = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine(isPushServiceEndpoint, { message: 'Unknown push service' })

export const pushSubscriptionInputSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>

export const pushEndpointInputSchema = z.object({ endpoint: pushEndpointSchema })

export const pushSubscriptionStatusOkSchema = z.object({
  ok: z.literal(true),
  subscribed: z.boolean(),
})

export const pushSubscriptionStatusResponseSchema = z.union([
  pushSubscriptionStatusOkSchema,
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const pushSubscriptionMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const notificationReadResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])
