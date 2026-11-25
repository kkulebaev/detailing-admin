import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { toRole } from '@detailing-admin/shared/auth'
import type { Tx } from '../db/audit.js'
import { getDb } from '../db/client.js'
import { masters, notifications, users, type NotificationRow } from '../db/schema.js'
import { baseLogger } from '../log.js'
import {
  moneyNotifications,
  type MoneyEvent,
  type NotificationDraft,
  type RecipientAccount,
} from './events.js'

type Reader = Pick<Tx, 'select'>

/** Пишет уведомления в транзакции события, но в точке сохранения: в норме лента
 * атомарна с изменением, а сбой уведомлений (в том числе поиска получателей) не
 * откатывает запись, выплату или решение по заявке. Поэтому получатели ищутся внутри
 * `build` через ту же точку сохранения: упавший запрос вне ее оборвал бы всю транзакцию. */
export async function insertNotifications(
  tx: Tx,
  build: (sp: Tx) => Promise<NotificationDraft[]>,
): Promise<NotificationRow[]> {
  try {
    return await tx.transaction(async (sp) => {
      const drafts = await build(sp)
      if (drafts.length === 0) return []
      return sp.insert(notifications).values(drafts).returning()
    })
  } catch (err) {
    baseLogger.warn(
      {
        event: 'notification.insert_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      'Notifications insert failed — action saved without them',
    )
    return []
  }
}

/** Аккаунты мастеров на момент события. Архивного мастера нет: его аккаунт уже
 * отвязан, а уведомлять о записях ушедшего мастера некого. */
export async function masterAccounts(
  db: Reader,
  masterIds: readonly number[],
): Promise<Map<number, RecipientAccount>> {
  const ids = [...new Set(masterIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ masterId: masters.id, userId: users.id, role: users.role })
    .from(masters)
    .innerJoin(users, eq(users.id, masters.userId))
    .where(and(inArray(masters.id, ids), eq(masters.archived, false)))
  return new Map(rows.map((r) => [r.masterId, { userId: r.userId, role: toRole(r.role) }]))
}

export async function adminUserIds(db: Reader): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'))
  return rows.map((r) => r.id)
}

/** Деньги и часы мастера, измененные админом. Самоправки через /api/me сюда не идут. */
export async function notifyMoney(
  tx: Tx,
  actorId: string | null,
  masterId: number,
  event: MoneyEvent,
): Promise<NotificationRow[]> {
  return insertNotifications(tx, async (sp) => {
    const account = (await masterAccounts(sp, [masterId])).get(masterId) ?? null
    return moneyNotifications(event, account, actorId)
  })
}

// ── Лента ───────────────────────────────────────────────────────────────────

/** Страница ленты по курсору `before` (id). Берет `limit + 1` строк, чтобы узнать о
 * продолжении без COUNT; курсор, а не offset, — чтобы свежее уведомление не сдвинуло
 * страницы и не дало дубль на стыке. */
export async function listNotifications(
  userId: string,
  p: { limit: number; before?: number },
): Promise<NotificationRow[]> {
  return getDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        p.before !== undefined ? lt(notifications.id, p.before) : undefined,
      ),
    )
    .orderBy(desc(notifications.id))
    .limit(p.limit + 1)
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return row?.count ?? 0
}

/** false — уведомления нет или оно чужое: для вызывающего это одно и то же. Повторное
 * прочтение не сдвигает `readAt`. */
export async function markNotificationRead(userId: string, id: number): Promise<boolean> {
  const rows = await getDb()
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id })
  return rows.length > 0
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
}
