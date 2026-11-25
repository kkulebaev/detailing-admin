import { and, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { pushSubscriptions, type PushSubscriptionRow } from '../db/schema.js'

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
  expiresAt: Date
}

/** Подписка жива, пока жива сохранившая ее сессия. */
export function sessionAlive(): SQL {
  return gt(pushSubscriptions.expiresAt, sql`now()`)
}

/** Endpoint принадлежит браузеру, а не аккаунту: если на этом телефоне вошел другой
 * пользователь, подписка переходит к нему, иначе пуши прежнего аккаунта шли бы
 * новому владельцу экрана. */
export async function upsertPushSubscription(
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
      },
    })
}

/** Только своя: чужой endpoint (подписку уже перевесили) удалять нельзя. */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
        sessionAlive(),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  return getDb()
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), sessionAlive()))
}

export async function deletePushSubscriptionsById(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await getDb()
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.id, [...ids]))
}

export async function markPushSubscriptionsSucceeded(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await getDb()
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date() })
    .where(inArray(pushSubscriptions.id, [...ids]))
}

export async function deleteExpiredPushSubscriptions(): Promise<number> {
  const deleted = await getDb()
    .delete(pushSubscriptions)
    .where(lt(pushSubscriptions.expiresAt, sql`now()`))
    .returning({ id: pushSubscriptions.id })
  return deleted.length
}
