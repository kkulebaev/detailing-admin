import { z } from 'zod'
import {
  notificationReadResponseSchema,
  notificationsListResponseSchema,
  notificationsUnreadResponseSchema,
  type Notification,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  getApiNotifications,
  getApiNotificationsUnreadCount,
  postApiNotificationsIdRead,
  postApiNotificationsReadAll,
} from './generated/notifications/notifications'

export type { Notification }

export type NotificationsListResult = z.infer<typeof notificationsListResponseSchema>
export type NotificationsUnreadResult = z.infer<typeof notificationsUnreadResponseSchema>
export type NotificationReadResult = z.infer<typeof notificationReadResponseSchema>

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
