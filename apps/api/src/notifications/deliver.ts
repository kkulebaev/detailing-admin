import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import {
  NOTIFICATION_CHANNEL_NAMES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type ExternalNotificationChannel,
} from '@detailing-admin/shared/notifications'
import { isDbReady } from '../boot.js'
import { getDb } from '../db/client.js'
import {
  notificationDeliveries,
  notifications,
  pushSubscriptions,
  users,
  type NotificationRow,
} from '../db/schema.js'
import { env } from '../env.js'
import { baseLogger } from '../log.js'
import { escapeHtml, sendTelegramMessage } from '../telegram.js'
import {
  deletePushSubscriptionsById,
  listPushSubscriptions,
  markPushSubscriptionsSucceeded,
} from './push-subscriptions.js'
import { countUnreadNotifications } from './store.js'
import { telegramChatIdOf, unlinkBlockedChat } from './telegram-link.js'
import { isPushEnabled, pushTopic, sendPush } from './web-push.js'

// Доставка во внешние каналы идет после коммита и мимо HTTP-ответа: сбой push-сервиса
// или Telegram не должен ни откатить действие, ни поменять его ответ. Лента — outbox, а
// notification_deliveries отмечает, какой канал уже занял строку. Отметка вставляется до
// отправки (ровно один отправитель на пару «уведомление, канал», даже если sweeper и
// вызов после коммита взяли строку одновременно) и снимается, только если канал не смог
// даже начать отправку: тогда строку для этого канала досылает sweeper, а другие каналы
// ее второй раз не получают.

type Channel = ExternalNotificationChannel

// Подзапросы sweeper'а только строят SQL, соединение им не нужно.
const qb = new QueryBuilder()

/** Канал недоступен целиком (нет ответа от API): `unsent` вернутся sweeper'у. */
class ChannelUnavailableError extends Error {
  constructor(readonly unsent: NotificationRow[]) {
    super('channel unavailable')
  }
}

type Send = (rows: NotificationRow[]) => Promise<void>

interface ChannelSender {
  enabled(): boolean
  /** Условие «у получателя канал подключен» для sweeper'а, коррелированное с notifications. */
  connected(): SQL
  /** Отправка одному получателю; null — канал у него не подключен, и строку канал не
   * занимает. Бросает, если не удалось узнать адресата (база): тоже ничего не занято. */
  prepare(userId: string): Promise<Send | null>
}

// В логи идут только тип, получатель и статус: текст уведомления несет имена и суммы.
function logSend(channel: Channel, row: NotificationRow, status: number | string) {
  baseLogger.info(
    { event: 'notification.delivery', channel, type: row.type, user_id: row.userId, status },
    'Notification delivery attempt',
  )
}

const pushChannel: ChannelSender = {
  enabled: isPushEnabled,
  connected: () =>
    exists(
      qb
        .select({ one: sql`1` })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, notifications.userId)),
    ),
  async prepare(userId) {
    const subs = await listPushSubscriptions(userId)
    if (subs.length === 0) return null
    return async (rows) => {
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
        // Отказ push-сервиса (5xx, 429, сеть) — состоявшаяся попытка: повтор пришел бы
        // на устройства, куда пуш уже дошел.
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
    }
  },
}

// WEB_ORIGIN может быть списком для CORS; ссылка ведет на первый. Проверяется один раз:
// кривой origin не должен ронять отправку, сообщение уйдет без ссылки.
let webOrigin: URL | null | undefined
function appOrigin(): URL | null {
  if (webOrigin !== undefined) return webOrigin
  try {
    webOrigin = new URL(env.WEB_ORIGIN.split(',')[0]!.trim())
  } catch {
    webOrigin = null
    baseLogger.warn(
      { event: 'notification.web_origin_invalid' },
      'WEB_ORIGIN is not a URL, Telegram messages go without a link',
    )
  }
  return webOrigin
}

/** Только для тестов: env подменяется между тестами, а origin кешируется. */
export function _resetWebOriginForTest(): void {
  webOrigin = undefined
}

export function telegramText(row: NotificationRow): string {
  const lines = [`<b>${escapeHtml(row.title)}</b>`, escapeHtml(row.pushBody ?? row.body)]
  const origin = appOrigin()
  if (origin) {
    const href = escapeHtml(new URL(row.link ?? '/notifications', origin).toString()).replace(
      /"/g,
      '&quot;',
    )
    lines.push('', `<a href="${href}">Открыть в приложении</a>`)
  }
  return lines.join('\n')
}

// Telegram просит не больше сообщения в секунду в один чат; пачка одному получателю
// идет с паузой, чтобы не получить 429.
let telegramChatGapMs = 1000
/** Только для тестов: без паузы между сообщениями. */
export function _setTelegramChatGapForTest(ms: number): void {
  telegramChatGapMs = ms
}

// После 429 Telegram называет, сколько ждать. До этого момента канал выключен: строки
// не занимаются, и sweeper подберет их, когда пауза кончится (в пределах 15 минут).
let telegramPausedUntil = 0
/** Только для тестов. */
export function _resetTelegramPauseForTest(): void {
  telegramPausedUntil = 0
}

const TELEGRAM_DEFAULT_RETRY_AFTER_S = 30

const telegramChannel: ChannelSender = {
  // Токен бота обязателен в env, так что канал есть всегда, кроме паузы после 429; без
  // привязанного чата prepare его просто пропускает.
  enabled: () => Date.now() >= telegramPausedUntil,
  connected: () =>
    exists(
      qb
        .select({ one: sql`1` })
        .from(users)
        .where(and(eq(users.id, notifications.userId), isNotNull(users.telegramChatId))),
    ),
  async prepare(userId) {
    const chatId = await telegramChatIdOf(userId)
    if (chatId === null) return null
    return async (rows) => {
      for (const [i, row] of rows.entries()) {
        if (i > 0 && telegramChatGapMs > 0) {
          await new Promise((r) => setTimeout(r, telegramChatGapMs))
        }
        let res
        try {
          res = await sendTelegramMessage(chatId, telegramText(row))
        } catch {
          // Уже отправленные строки возвращать нельзя: их получили бы второй раз.
          throw new ChannelUnavailableError(rows.slice(i))
        }
        logSend('telegram', row, res.status ?? 'error')
        // Ответа нет — до Telegram не достучались, и сообщение, скорее всего, не ушло.
        if (res.status === undefined) throw new ChannelUnavailableError(rows.slice(i))
        // Перегрузка или сбой на стороне Telegram: сообщение не принято, дошлет sweeper.
        if (res.status === 429 || res.status >= 500) {
          if (res.status === 429) {
            const seconds = res.retryAfter ?? TELEGRAM_DEFAULT_RETRY_AFTER_S
            telegramPausedUntil = Math.max(telegramPausedUntil, Date.now() + seconds * 1000)
          }
          throw new ChannelUnavailableError(rows.slice(i))
        }
        // 400 (чат не найден и т. п.) — окончательный ответ по этой строке.
        if (res.status === 403) {
          // Бот заблокирован или аккаунт удален: чат мертв, остальное слать некуда.
          try {
            await unlinkBlockedChat(userId, chatId)
          } catch {
            baseLogger.warn(
              { event: 'notification.telegram_unlink_failed', user_id: userId },
              'Failed to unlink blocked Telegram chat',
            )
          }
          return
        }
      }
    }
  },
}

// Какие типы куда идут, решает NOTIFICATION_CHANNELS в shared.
const CHANNELS: Record<Channel, ChannelSender> = { push: pushChannel, telegram: telegramChannel }

const routedTo = (name: Channel, row: NotificationRow) =>
  NOTIFICATION_CHANNELS[row.type].includes(name)

function activeChannels(): [Channel, ChannelSender][] {
  return NOTIFICATION_CHANNEL_NAMES.filter((n): n is Channel => n !== 'feed')
    .map((n): [Channel, ChannelSender] => [n, CHANNELS[n]])
    .filter(([, c]) => c.enabled())
}

const inFlight = new Set<Promise<void>>()

/** Занимает канал для строк, у которых его еще нет, и возвращает их id: строку, которую
 * этот канал уже занял другой отправитель, этот не трогает. */
async function claim(channel: Channel, ids: number[]): Promise<Set<number>> {
  const rows = await getDb()
    .insert(notificationDeliveries)
    .values(ids.map((notificationId) => ({ notificationId, channel })))
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.notificationId })
  return new Set(rows.map((r) => r.id))
}

async function release(channel: Channel, ids: number[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await getDb()
      .delete(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channel, channel),
          inArray(notificationDeliveries.notificationId, ids),
        ),
      )
  } catch {
    baseLogger.warn(
      { event: 'notification.release_failed', channel, count: ids.length },
      'Failed to return notifications to the outbox',
    )
  }
}

async function deliverVia(
  name: Channel,
  channel: ChannelSender,
  userId: string,
  rows: NotificationRow[],
): Promise<void> {
  const own = rows.filter((r) => routedTo(name, r))
  if (own.length === 0) return
  const warnFailed = () =>
    // Без err.message: ошибка драйвера несет текст запроса с параметрами.
    baseLogger.warn(
      { event: 'notification.channel_failed', channel: name, user_id: userId },
      'Notification channel failed',
    )
  let send: Send | null
  try {
    send = await channel.prepare(userId)
  } catch {
    // Ничего не занято: строку подберет sweeper.
    warnFailed()
    return
  }
  if (!send) return
  let claimed: Set<number>
  try {
    claimed = await claim(
      name,
      own.map((r) => r.id),
    )
  } catch {
    baseLogger.warn(
      { event: 'notification.claim_failed', channel: name, count: own.length },
      'Failed to claim notifications for delivery',
    )
    return
  }
  const mine = own.filter((r) => claimed.has(r.id))
  if (mine.length === 0) return
  try {
    await send(mine)
  } catch (err) {
    warnFailed()
    const unsent = err instanceof ChannelUnavailableError ? err.unsent : mine
    await release(
      name,
      unsent.map((r) => r.id),
    )
  }
}

async function deliver(rows: NotificationRow[], channels: [Channel, ChannelSender][]) {
  const byUser = new Map<string, NotificationRow[]>()
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
  // Каналы независимы: медленный Telegram не задерживает пуш.
  await Promise.all(
    [...byUser].flatMap(([userId, userRows]) =>
      channels.map(([name, channel]) => deliverVia(name, channel, userId, userRows)),
    ),
  )
}

/** Fire-and-forget: вызывается после коммита и никогда не бросает. Если ни одна строка
 * не идет ни в один включенный канал, в базу не ходит вовсе. */
export function deliverNotifications(rows: readonly NotificationRow[]): void {
  if (rows.length === 0) return
  const channels = activeChannels().filter(([name]) => rows.some((r) => routedTo(name, r)))
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

// Старше 15 минут не досылаем: сообщение о давно прошедшем событии только мешает, оно и
// так в ленте. Моложе 10 секунд не трогаем: эти строки только что закоммичены, их занимает
// собственный вызов deliverNotifications, и лишний запрос sweeper'а ничего не дал бы.
const SWEEP_MAX_AGE_MINUTES = 15
const SWEEP_MIN_AGE_SECONDS = 10
const SWEEP_BATCH = 500
const SWEEP_INTERVAL_MS = 60_000

/** Строка ждет канал, если тип туда идет, у получателя канал подключен, а отметки
 * этого канала еще нет. */
function pendingFor(name: Channel, channel: ChannelSender): SQL | undefined {
  const types = NOTIFICATION_TYPES.filter((t) => NOTIFICATION_CHANNELS[t].includes(name))
  if (types.length === 0) return undefined
  return and(
    inArray(notifications.type, types),
    channel.connected(),
    notExists(
      qb
        .select({ one: sql`1` })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.notificationId, notifications.id),
            eq(notificationDeliveries.channel, name),
          ),
        ),
    ),
  )
}

export async function sweepUndelivered(): Promise<void> {
  if (!isDbReady()) return
  const pending = activeChannels()
    .map(([name, channel]) => pendingFor(name, channel))
    .filter((c) => c !== undefined)
  if (pending.length === 0) return
  try {
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(
        and(
          gt(notifications.createdAt, sql`now() - make_interval(mins => ${SWEEP_MAX_AGE_MINUTES})`),
          lt(notifications.createdAt, sql`now() - make_interval(secs => ${SWEEP_MIN_AGE_SECONDS})`),
          or(...pending),
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
