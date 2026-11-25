import { lt, sql } from 'drizzle-orm'
import { NOTIFICATION_RETENTION_DAYS } from '@detailing-admin/shared/notifications'
import { isDbReady } from '../boot.js'
import { getDb } from '../db/client.js'
import { notifications } from '../db/schema.js'
import { baseLogger } from '../log.js'

const DAY_MS = 24 * 60 * 60 * 1000

export async function deleteOldNotifications(): Promise<number> {
  const deleted = await getDb()
    .delete(notifications)
    .where(
      lt(
        notifications.createdAt,
        sql`now() - make_interval(days => ${NOTIFICATION_RETENTION_DAYS})`,
      ),
    )
    .returning({ id: notifications.id })
  return deleted.length
}

async function runCleanup(): Promise<void> {
  // Без базы чистить нечего; следующий запуск будет через сутки или после рестарта.
  if (!isDbReady()) return
  try {
    const deleted = await deleteOldNotifications()
    baseLogger.info({ event: 'notifications.cleanup', deleted }, 'Old notifications deleted')
  } catch (err) {
    baseLogger.warn(
      {
        event: 'notifications.cleanup_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      'Notifications cleanup failed',
    )
  }
}

/** Запускается из main.ts после serve(), а не из init(): boot.test вызывает настоящий
 * init, а таймер не должен держать процесс vitest. По той же причине unref(). */
export function startNotificationsCleanup(): ReturnType<typeof setInterval> {
  void runCleanup()
  const timer = setInterval(() => void runCleanup(), DAY_MS)
  timer.unref()
  return timer
}
