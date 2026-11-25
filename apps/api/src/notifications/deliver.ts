import { and, asc, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '@detailing-admin/shared/notifications'
import { isDbReady } from '../boot.js'
import { getDb } from '../db/client.js'
import { notifications, type NotificationRow } from '../db/schema.js'
import { baseLogger } from '../log.js'
import {
  deletePushSubscriptionsById,
  listPushSubscriptions,
  markPushSubscriptionsSucceeded,
} from './push-subscriptions.js'
import { countUnreadNotifications } from './store.js'
import { isPushEnabled, pushTopic, sendPush } from './web-push.js'

// Доставка во внешние каналы идет после коммита и мимо HTTP-ответа: сбой push-сервиса
// не должен ни откатить действие, ни поменять его ответ. Строка ленты — outbox:
// `deliveredAt` ставится условным UPDATE до отправки (строку «занимает» ровно один
// отправитель, даже если sweeper и вызов после коммита взяли ее одновременно), а при
// сбое канала целиком снимается обратно, и строку досылает sweeper.

type ExternalChannel = Exclude<NotificationChannel, 'feed'>

interface ChannelSender {
  enabled(): boolean
  /** Строки одного получателя, уже отфильтрованные по политике канала. Бросает, только
   * если не удалось начать отправку (например, база не отдала подписки): тогда строки
   * вернутся sweeper'у. Отказ push-сервиса (5xx, 429) — состоявшаяся попытка. */
  send(userId: string, rows: NotificationRow[]): Promise<void>
}

// В логи идут только тип, получатель и статус: текст уведомления несет имена и суммы.
function logSend(channel: ExternalChannel, row: NotificationRow, status: number | string) {
  baseLogger.info(
    { event: 'notification.delivery', channel, type: row.type, user_id: row.userId, status },
    'Notification delivery attempt',
  )
}

const pushChannel: ChannelSender = {
  enabled: isPushEnabled,
  async send(userId, rows) {
    const subs = await listPushSubscriptions(userId)
    if (subs.length === 0) return
    const unread = await countUnreadNotifications(userId)
    const gone = new Set<number>()
    const succeeded = new Set<number>()
    for (const row of rows) {
      const topic = pushTopic(row.type, row.link)
      const payload = {
        title: row.title,
        body: row.pushBody ?? row.body,
        link: row.link ?? '/notifications',
        tag: topic,
        unread,
      }
      await Promise.all(
        subs
          .filter((s) => !gone.has(s.id))
          .map(async (s) => {
            const res = await sendPush(s, payload, topic)
            logSend('push', row, res.status ?? 'error')
            if (res.ok) succeeded.add(s.id)
            else if (res.gone) gone.add(s.id)
          }),
      )
    }
    // Пуши уже ушли: сбой этой уборки не повод слать их второй раз.
    try {
      await deletePushSubscriptionsById([...gone])
      await markPushSubscriptionsSucceeded([...succeeded].filter((id) => !gone.has(id)))
    } catch {
      baseLogger.warn(
        { event: 'notification.push_bookkeeping_failed', user_id: userId },
        'Push subscription bookkeeping failed',
      )
    }
  },
}

// Новый канал (Telegram) добавляется сюда одной строкой; какие типы куда идут,
// решает NOTIFICATION_CHANNELS в shared.
const CHANNELS: Partial<Record<ExternalChannel, ChannelSender>> = { push: pushChannel }

function activeChannels(): [ExternalChannel, ChannelSender][] {
  return Object.entries(CHANNELS).filter(
    (e): e is [ExternalChannel, ChannelSender] => e[1] !== undefined && e[1].enabled(),
  )
}

const inFlight = new Set<Promise<void>>()

/** Ставит deliveredAt только тем строкам, у которых его еще нет, и возвращает их id:
 * строку, которую уже занял другой отправитель, этот не трогает. */
async function claim(ids: number[]): Promise<Set<number>> {
  const rows = await getDb()
    .update(notifications)
    .set({ deliveredAt: new Date() })
    .where(and(inArray(notifications.id, ids), isNull(notifications.deliveredAt)))
    .returning({ id: notifications.id })
  return new Set(rows.map((r) => r.id))
}

async function release(ids: number[]): Promise<void> {
  try {
    await getDb()
      .update(notifications)
      .set({ deliveredAt: null })
      .where(inArray(notifications.id, ids))
  } catch {
    baseLogger.warn(
      { event: 'notification.release_failed', count: ids.length },
      'Failed to return notifications to the outbox',
    )
  }
}

// Сбой канала целиком возвращает строку в outbox для всех ее каналов: отдельного
// статуса на канал нет, и при повторе удачный канал получит ее второй раз. С одним push
// это не проявляется; с Telegram стоит завести статус на канал.
async function deliver(rows: NotificationRow[], channels: [ExternalChannel, ChannelSender][]) {
  let claimed: Set<number>
  try {
    claimed = await claim(rows.map((r) => r.id))
  } catch {
    // Строка осталась с deliveredAt = null, ее подберет sweeper.
    baseLogger.warn(
      { event: 'notification.claim_failed', count: rows.length },
      'Failed to claim notifications for delivery',
    )
    return
  }
  const mine = rows.filter((r) => claimed.has(r.id))
  const failed = new Set<number>()
  const byUser = new Map<string, NotificationRow[]>()
  for (const r of mine) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
  await Promise.all(
    [...byUser].map(async ([userId, userRows]) => {
      for (const [name, channel] of channels) {
        const own = userRows.filter((r) => NOTIFICATION_CHANNELS[r.type].includes(name))
        if (own.length === 0) continue
        try {
          await channel.send(userId, own)
        } catch {
          // Без err.message: ошибка драйвера несет текст запроса с параметрами.
          baseLogger.warn(
            { event: 'notification.channel_failed', channel: name, user_id: userId },
            'Notification channel failed',
          )
          for (const r of own) failed.add(r.id)
        }
      }
    }),
  )
  if (failed.size > 0) await release([...failed])
}

/** Fire-and-forget: вызывается после коммита и никогда не бросает. Без включенных
 * каналов в базу не ходит вовсе: `deliveredAt` нужен только для досылки. */
export function deliverNotifications(rows: readonly NotificationRow[]): void {
  if (rows.length === 0) return
  const channels = activeChannels()
  if (channels.length === 0) return
  const task = deliver([...rows], channels)
    .catch(() => {})
    .finally(() => inFlight.delete(task))
  inFlight.add(task)
}

/** Для SIGTERM: дать доставкам в полете до `timeoutMs`, но не держать остановку дольше. */
export async function drainDeliveries(timeoutMs: number): Promise<void> {
  if (inFlight.size === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled([...inFlight]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  clearTimeout(timer)
}

// Старше 15 минут не досылаем: пуш о давно прошедшем событии только мешает, оно и так
// в ленте. Моложе 10 секунд не трогаем: эти строки только что закоммичены, их занимает
// собственный вызов deliverNotifications, и лишний запрос sweeper'а ничего не дал бы.
const SWEEP_MAX_AGE_MINUTES = 15
const SWEEP_MIN_AGE_SECONDS = 10
const SWEEP_BATCH = 500
const SWEEP_INTERVAL_MS = 60_000

export async function sweepUndelivered(): Promise<void> {
  if (!isDbReady() || activeChannels().length === 0) return
  try {
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(
        and(
          isNull(notifications.deliveredAt),
          gt(notifications.createdAt, sql`now() - make_interval(mins => ${SWEEP_MAX_AGE_MINUTES})`),
          lt(notifications.createdAt, sql`now() - make_interval(secs => ${SWEEP_MIN_AGE_SECONDS})`),
        ),
      )
      .orderBy(asc(notifications.id))
      .limit(SWEEP_BATCH)
    deliverNotifications(rows)
  } catch {
    baseLogger.warn(
      { event: 'notification.sweep_failed' },
      'Undelivered notifications sweep failed',
    )
  }
}

/** Из main.ts после serve(), как cleanup: таймер с unref не держит процесс vitest. */
export function startDeliverySweeper(): ReturnType<typeof setInterval> {
  void sweepUndelivered()
  const timer = setInterval(() => void sweepUndelivered(), SWEEP_INTERVAL_MS)
  timer.unref()
  return timer
}
