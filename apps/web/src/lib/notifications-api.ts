import { z } from 'zod'
import {
  notificationReadResponseSchema,
  notificationsListResponseSchema,
  notificationsUnreadResponseSchema,
  pushConfigResponseSchema,
  pushSubscriptionMutationResponseSchema,
  pushSubscriptionStatusResponseSchema,
  telegramLinkResponseSchema,
  telegramStatusResponseSchema,
  telegramUnlinkResponseSchema,
  type Notification,
  type PushSubscriptionInput,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  deleteApiNotificationsPushSubscriptions,
  getApiNotifications,
  getApiNotificationsPushConfig,
  postApiNotificationsPushSubscriptionsCurrent,
  getApiNotificationsUnreadCount,
  postApiNotificationsIdRead,
  postApiNotificationsPushSubscriptions,
  postApiNotificationsReadAll,
  getApiNotificationsTelegram,
  postApiNotificationsTelegramLink,
  deleteApiNotificationsTelegram,
} from './generated/notifications/notifications'

export type { Notification }

export type NotificationsListResult = z.infer<typeof notificationsListResponseSchema>
export type NotificationsUnreadResult = z.infer<typeof notificationsUnreadResponseSchema>
export type NotificationReadResult = z.infer<typeof notificationReadResponseSchema>
export type PushConfigResult = z.infer<typeof pushConfigResponseSchema>
export type PushSubscriptionStatusResult = z.infer<typeof pushSubscriptionStatusResponseSchema>
export type PushSubscriptionMutationResult = z.infer<typeof pushSubscriptionMutationResponseSchema>
export type TelegramStatusResult = z.infer<typeof telegramStatusResponseSchema>
export type TelegramLinkResult = z.infer<typeof telegramLinkResponseSchema>
export type TelegramUnlinkResult = z.infer<typeof telegramUnlinkResponseSchema>

export function fetchNotifications(
  params: { before?: number } = {},
): Promise<NotificationsListResult> {
  return unwrap<NotificationsListResult>(() =>
    getApiNotifications(params.before === undefined ? {} : { before: String(params.before) }),
  )
}

export function fetchUnreadNotificationsCount(): Promise<NotificationsUnreadResult> {
  return unwrap<NotificationsUnreadResult>(() => getApiNotificationsUnreadCount())
}

export function markNotificationRead(id: number): Promise<NotificationReadResult> {
  return unwrap<NotificationReadResult>(() => postApiNotificationsIdRead(String(id)))
}

export function markAllNotificationsRead(): Promise<NotificationReadResult> {
  return unwrap<NotificationReadResult>(() => postApiNotificationsReadAll())
}

export function fetchPushConfig(): Promise<PushConfigResult> {
  return unwrap<PushConfigResult>(() => getApiNotificationsPushConfig())
}

export function savePushSubscription(
  payload: PushSubscriptionInput,
): Promise<PushSubscriptionMutationResult> {
  return unwrap<PushSubscriptionMutationResult>(() =>
    postApiNotificationsPushSubscriptions(payload),
  )
}

export function deletePushSubscription(endpoint: string): Promise<PushSubscriptionMutationResult> {
  return unwrap<PushSubscriptionMutationResult>(() =>
    deleteApiNotificationsPushSubscriptions({ endpoint }),
  )
}

export function fetchPushSubscriptionStatus(
  endpoint: string,
): Promise<PushSubscriptionStatusResult> {
  return unwrap<PushSubscriptionStatusResult>(() =>
    postApiNotificationsPushSubscriptionsCurrent({ endpoint }),
  )
}

export function fetchTelegramStatus(): Promise<TelegramStatusResult> {
  return unwrap<TelegramStatusResult>(() => getApiNotificationsTelegram())
}

export function createTelegramLink(): Promise<TelegramLinkResult> {
  return unwrap<TelegramLinkResult>(() => postApiNotificationsTelegramLink())
}

export function unlinkTelegram(): Promise<TelegramUnlinkResult> {
  return unwrap<TelegramUnlinkResult>(() => deleteApiNotificationsTelegram())
}
