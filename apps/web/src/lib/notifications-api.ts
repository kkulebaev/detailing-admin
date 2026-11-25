import { z } from 'zod'
import {
  notificationReadResponseSchema,
  notificationsListResponseSchema,
  notificationsUnreadResponseSchema,
  pushConfigResponseSchema,
  pushSubscriptionMutationResponseSchema,
  pushSubscriptionStatusResponseSchema,
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
} from './generated/notifications/notifications'

export type { Notification }

export type NotificationsListResult = z.infer<typeof notificationsListResponseSchema>
export type NotificationsUnreadResult = z.infer<typeof notificationsUnreadResponseSchema>
export type NotificationReadResult = z.infer<typeof notificationReadResponseSchema>
export type PushConfigResult = z.infer<typeof pushConfigResponseSchema>
export type PushSubscriptionStatusResult = z.infer<typeof pushSubscriptionStatusResponseSchema>
export type PushSubscriptionMutationResult = z.infer<typeof pushSubscriptionMutationResponseSchema>

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
