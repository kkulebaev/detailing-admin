import { describe, it, expect, vi, beforeEach } from 'vitest'

// Изменяемый env: часть тестов проверяет поведение без VAPID.
const envMock = vi.hoisted(() => ({
  VAPID_PUBLIC_KEY: 'BPublic' as string | undefined,
  VAPID_PRIVATE_KEY: 'private' as string | undefined,
  VAPID_SUBJECT: 'mailto:owner@example.com' as string | undefined,
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
}))

vi.mock('../src/env.js', () => ({ env: envMock }))
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))
vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))
vi.mock('../src/boot.js', () => ({ isDbReady: vi.fn().mockReturnValue(true) }))

import { getTableName, type Table } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { WebPushError, type RequestOptions } from 'web-push'
import { isDbReady } from '../src/boot.js'
import { getDb } from '../src/db/client.js'
import type { NotificationRow, PushSubscriptionRow } from '../src/db/schema.js'
import { baseLogger } from '../src/log.js'
import {
  _resetTelegramPauseForTest,
  _setTelegramChatGapForTest,
  deliverNotifications,
  drainDeliveries,
  sweepUndelivered,
} from '../src/notifications/deliver.js'
import { _setPushSenderForTest } from '../src/notifications/web-push.js'
import { _setFetchForTest } from '../src/telegram.js'

const render = (w: unknown) => new PgDialect().sqlToQuery(w as never)

interface Call {
  op: string
  table: string
  fields?: Record<string, unknown>
  where?: unknown
  set?: Record<string, unknown>
  values?: unknown
}

type Fail = Error | undefined

// Фейк query builder с отметками каналов в памяти: INSERT … ON CONFLICT DO NOTHING
// отдает только еще не занятые пары «уведомление, канал», DELETE их снимает. Так повтор
// sweeper'а видит то же, что увидел бы настоящий Postgres.
function makeDb(opts: {
  subs?: PushSubscriptionRow[] | Error
  unread?: number | Error
  chatId?: string | null | Error
  sweep?: NotificationRow[]
  claimed?: string[]
  failClaim?: boolean
}) {
  const claimed = new Set(opts.claimed ?? [])
  const calls: Call[] = []
  const result = (v: unknown) => {
    if (v instanceof Error) throw v
    return v
  }
  const chain = (op: string, table: Table | undefined, next: (call: Call) => unknown) => {
    const call: Call = { op, table: table ? getTableName(table) : '' }
    calls.push(call)
    const c: Record<string, unknown> = {}
    for (const m of ['orderBy', 'limit', 'returning', 'onConflictDoNothing']) c[m] = () => c
    c.from = (t: Table) => {
      call.table = getTableName(t)
      return c
    }
    c.where = (w: unknown) => {
      call.where = w
      return c
    }
    c.set = (v: Record<string, unknown>) => {
      call.set = v
      return c
    }
    c.values = (v: unknown) => {
      call.values = v
      return c
    }
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => next(call))
        .then(res, rej)
    return c
  }
  const db = {
    select: (fields?: Record<string, unknown>) => {
      const c = chain('select', undefined, (call) => {
        if (call.table === 'push_subscriptions') return result(opts.subs ?? [])
        if (call.table === 'users') {
          const chat = result(opts.chatId ?? null)
          return [{ chatId: chat }]
        }
        if (call.table === 'notifications' && call.fields && 'count' in call.fields) {
          return [{ count: result(opts.unread ?? 1) }]
        }
        return opts.sweep ?? []
      })
      calls.at(-1)!.fields = fields
      return c
    },
    insert: (t: Table) =>
      chain('insert', t, (call) => {
        if (opts.failClaim) throw new Error('db down')
        const values = call.values as { notificationId: number; channel: string }[]
        const fresh = values.filter((v) => !claimed.has(`${v.notificationId}:${v.channel}`))
        for (const v of fresh) claimed.add(`${v.notificationId}:${v.channel}`)
        return fresh.map((v) => ({ id: v.notificationId }))
      }),
    delete: (t: Table) =>
      chain('delete', t, (call) => {
        if (call.table === 'notification_deliveries') {
          const params = render(call.where).params
          const channel = params.find((p) => typeof p === 'string')
          for (const id of params.filter((p) => typeof p === 'number')) {
            claimed.delete(`${id}:${channel}`)
          }
        }
        return []
      }),
    update: (t: Table) => chain('update', t, () => []),
  }
  vi.mocked(getDb).mockReturnValue(db as never)
  return { calls, claimed }
}

type Db = ReturnType<typeof makeDb>
const claimsOf = (db: Db, channel: string) =>
  db.calls
    .filter((c) => c.op === 'insert')
    .flatMap((c) => c.values as { notificationId: number; channel: string }[])
    .filter((v) => v.channel === channel)
const releasesOf = (db: Db) =>
  db.calls.filter((c) => c.op === 'delete' && c.table === 'notification_deliveries')

let nextId = 1
const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: nextId++,
  userId: 'u-emp',
  type: 'booking.assigned',
  title: 'Новая запись',
  body: '26.11, 10:00 · Иван Петров · Kia Rio · Полировка',
  link: '/bookings?booking=bk1',
  pushBody: '26.11, 10:00 · Kia Rio · Полировка',
  createdAt: new Date(),
  readAt: null,
  ...over,
})

const money = (over: Partial<NotificationRow> = {}) =>
  row({
    type: 'payout.changed',
    title: 'Выплата <3 000 ₽>',
    body: 'Аванс & премия · 20.11.2026',
    pushBody: null,
    link: '/employee',
    ...over,
  })

const sub = (id: number, endpoint: string): PushSubscriptionRow => ({
  id,
  userId: 'u-emp',
  endpoint,
  p256dh: 'p256',
  auth: 'auth',
  userAgent: null,
  createdAt: new Date(),
  lastSuccessAt: null,
})

type Sent = { endpoint: string; payload: Record<string, unknown>; options: RequestOptions }

function fakeSender(statusFor: (endpoint: string) => number | Error = () => 201) {
  const sent: Sent[] = []
  _setPushSenderForTest(async (subscription, payload, options) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(String(payload)), options })
    const status = statusFor(subscription.endpoint)
    if (status instanceof Error) throw status
    if (status >= 400) throw new WebPushError('push failed', status, {}, '', subscription.endpoint)
    return { statusCode: status, body: '', headers: {} }
  })
  return sent
}

type TgSent = { chat_id: string; text: string; parse_mode: string }

type TgAnswer = number | Error | { status: 429; retryAfter: number }

/** Ответ Telegram на каждый sendMessage по порядку; Error — ответа нет (сеть). */
function fakeTelegram(...answers: TgAnswer[]) {
  const sent: TgSent[] = []
  const at: number[] = []
  _setFetchForTest(async (url, init) => {
    expect(String(url)).toContain('/sendMessage')
    sent.push(JSON.parse(String(init?.body)))
    at.push(performance.now())
    const answer = answers.length > 1 ? answers.shift()! : (answers[0] ?? 200)
    if (answer instanceof Error) throw answer
    if (typeof answer === 'object') {
      return Response.json(
        {
          ok: false,
          description: 'Too Many Requests',
          parameters: { retry_after: answer.retryAfter },
        },
        { status: 429 },
      )
    }
    return Response.json(
      answer === 200
        ? { ok: true }
        : {
            ok: false,
            description: answer === 403 ? 'Forbidden: bot was blocked by the user' : 'x',
          },
      { status: answer },
    )
  })
  return Object.assign(sent, { at })
}

beforeEach(() => {
  envMock.VAPID_PUBLIC_KEY = 'BPublic'
  envMock.VAPID_PRIVATE_KEY = 'private'
  envMock.VAPID_SUBJECT = 'mailto:owner@example.com'
  vi.mocked(isDbReady).mockReturnValue(true)
  vi.mocked(getDb).mockReset()
  vi.mocked(baseLogger.info).mockClear()
  vi.mocked(baseLogger.warn).mockClear()
  fakeTelegram(new Error('unexpected Telegram call'))
  _setTelegramChatGapForTest(0)
  _resetTelegramPauseForTest()
})

describe('deliverNotifications — Web Push', () => {
  it('шлет на все подписки, payload без имени клиента у booking.* (критерий 6l)', async () => {
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], unread: 3 })
    const sent = fakeSender()
    const n = row()
    deliverNotifications([n])
    await drainDeliveries(1000)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toEqual({
      title: 'Новая запись',
      body: '26.11, 10:00 · Kia Rio · Полировка',
      link: '/notifications',
      tag: expect.any(String),
      unread: 3,
    })
    expect(JSON.stringify(sent[0]!.payload)).not.toContain('Иван')
    expect(sent[0]!.options).toMatchObject({ TTL: 86400, topic: sent[0]!.payload.tag })
    expect(String(sent[0]!.options.topic)).toMatch(/^[A-Za-z0-9_-]{1,32}$/)

    // Канал занимается до отправки, успех отмечает подписку.
    expect(claimsOf(db, 'push')).toEqual([{ notificationId: n.id, channel: 'push' }])
    expect(db.claimed).toEqual(new Set([`${n.id}:push`]))
    expect(db.calls.some((c) => c.set && 'lastSuccessAt' in c.set)).toBe(true)
    expect(releasesOf(db)).toHaveLength(0)
  })

  it('без pushBody в пуш идет body', async () => {
    makeDb({ subs: [sub(1, 'https://push.example/a')] })
    const sent = fakeSender()
    deliverNotifications([
      row({ type: 'payout.changed', pushBody: null, body: '3 000 ₽ · 20.11.2026', link: null }),
    ])
    await drainDeliveries(1000)
    expect(sent[0]!.payload).toMatchObject({ body: '3 000 ₽ · 20.11.2026', link: '/notifications' })
  })

  it('410 и 404 удаляют подписку, 500 — нет (критерий 10)', async () => {
    const db = makeDb({
      subs: [
        sub(1, 'https://push.example/gone'),
        sub(2, 'https://push.example/missing'),
        sub(3, 'https://push.example/flaky'),
      ],
    })
    fakeSender((e) => (e.endsWith('gone') ? 410 : e.endsWith('missing') ? 404 : 500))
    const n = row()
    deliverNotifications([n])
    await drainDeliveries(1000)

    const deletes = db.calls.filter((c) => c.op === 'delete' && c.table === 'push_subscriptions')
    expect(deletes).toHaveLength(1)
    expect(render(deletes[0]!.where).params).toEqual([1, 2])
    // 5xx — состоявшаяся попытка: канал остается занятым, sweeper его не дошлет.
    expect(releasesOf(db)).toHaveLength(0)
    expect(db.claimed.has(`${n.id}:push`)).toBe(true)
  })

  it('в логах только тип, получатель и статус, без текста', async () => {
    makeDb({ subs: [sub(1, 'https://push.example/a')] })
    fakeSender(() => 410)
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(vi.mocked(baseLogger.info)).toHaveBeenCalledWith(
      {
        event: 'notification.delivery',
        channel: 'push',
        type: 'booking.assigned',
        user_id: 'u-emp',
        status: 410,
      },
      expect.any(String),
    )
    const logged = JSON.stringify(vi.mocked(baseLogger.info).mock.calls)
    expect(logged).not.toContain('Kia')
    expect(logged).not.toContain('push.example')
  })

  it('не бросает: сеть падает, а вызывающий ничего не замечает', async () => {
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')] })
    fakeSender(() => new Error('socket hang up'))
    expect(() => deliverNotifications([row()])).not.toThrow()
    await drainDeliveries(1000)
    expect(releasesOf(db)).toHaveLength(0)
  })

  it('канал, уже занятый другим отправителем, не отправляет', async () => {
    const n = row()
    makeDb({ subs: [sub(1, 'https://push.example/a')], claimed: [`${n.id}:push`] })
    const sent = fakeSender()
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
  })

  it("если занять канал не удалось, ничего не шлет и оставляет строку sweeper'у", async () => {
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], failClaim: true })
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(releasesOf(db)).toHaveLength(0)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.claim_failed', channel: 'push' }),
      expect.any(String),
    )
  })

  it('база не отдала подписки: канал не занят, строку дошлет sweeper', async () => {
    const db = makeDb({ subs: new Error('db down') })
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(db.claimed.size).toBe(0)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.channel_failed', channel: 'push' }),
      expect.any(String),
    )
  })

  it('сбой канала после занятия (счетчик не прочитался) возвращает строку в outbox', async () => {
    const n = row()
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], unread: new Error('db down') })
    const sent = fakeSender()
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(claimsOf(db, 'push')).toHaveLength(1)
    const back = releasesOf(db)
    expect(back).toHaveLength(1)
    expect(render(back[0]!.where).params).toEqual(['push', n.id])
    expect(db.claimed.size).toBe(0)
  })

  it('без подписок пушей нет и канал не занимается', async () => {
    const db = makeDb({ subs: [] })
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(0)
  })

  it('без VAPID подписки на пуши не ищет вовсе (критерий 9)', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({})
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(db.calls.some((c) => c.table === 'push_subscriptions')).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('deliverNotifications — Telegram', () => {
  it('booking.* уходят в чат текстом pushBody, без имени клиента', async () => {
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], chatId: '555' })
    fakeSender()
    const tg = fakeTelegram(200)
    const rows = [
      row({ type: 'booking.assigned' }),
      row({ type: 'booking.changed' }),
      row({ type: 'booking.unassigned' }),
    ]
    deliverNotifications(rows)
    await drainDeliveries(1000)
    expect(tg.map((m) => m.text)).toEqual(
      rows.map(() => ['<b>Новая запись</b>', '26.11, 10:00 · Kia Rio · Полировка'].join('\n')),
    )
    expect(tg.map((m) => m.text).join('\n')).not.toContain('Иван Петров')
    expect(claimsOf(db, 'telegram')).toHaveLength(3)
  })

  it('деньги уходят в чат: HTML экранирован, ссылки нет', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({ chatId: '555' })
    const tg = fakeTelegram(200)
    const n = money()
    deliverNotifications([n])
    await drainDeliveries(1000)

    expect(tg).toHaveLength(1)
    expect(tg[0]).toMatchObject({ chat_id: '555', parse_mode: 'HTML' })
    expect(tg[0]!.text).toBe(
      ['<b>Выплата &lt;3 000 ₽&gt;</b>', 'Аванс &amp; премия · 20.11.2026'].join('\n'),
    )
    expect(tg[0]!.text).not.toMatch(/href|<a\b/)
    expect(claimsOf(db, 'telegram')).toEqual([{ notificationId: n.id, channel: 'telegram' }])
    expect(vi.mocked(baseLogger.info)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'telegram', type: 'payout.changed', status: 200 }),
      expect.any(String),
    )
    const logged = JSON.stringify(vi.mocked(baseLogger.info).mock.calls)
    expect(logged).not.toContain('555')
    expect(logged).not.toContain('Аванс')
  })

  it('pushBody, если есть, важнее body', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    makeDb({ chatId: '555' })
    const tg = fakeTelegram(200)
    deliverNotifications([money({ pushBody: 'Коротко', link: null })])
    await drainDeliveries(1000)
    expect(tg[0]!.text.split('\n')).toEqual([expect.any(String), 'Коротко'])
  })

  it('без привязанного чата ничего не шлет и канал не занимает', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({ chatId: null })
    const tg = fakeTelegram()
    deliverNotifications([money()])
    await drainDeliveries(1000)
    expect(tg).toHaveLength(0)
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(0)
  })

  it('403 «bot was blocked by the user» отвязывает именно этот чат', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({ chatId: '555' })
    const tg = fakeTelegram(403)
    const n = money()
    deliverNotifications([n, money()])
    await drainDeliveries(1000)

    // После 403 слать в этот чат больше нечего.
    expect(tg).toHaveLength(1)
    const unlink = db.calls.filter((c) => c.op === 'update' && c.table === 'users')
    expect(unlink).toHaveLength(1)
    expect(unlink[0]!.set).toEqual({ telegramChatId: null })
    const where = render(unlink[0]!.where)
    expect(where.sql).toMatch(/"id" = \$1 and "users"."telegram_chat_id" = \$2/)
    expect(where.params).toEqual(['u-emp', '555'])
    // Попытка состоялась: sweeper не повторит.
    expect(releasesOf(db)).toHaveLength(0)
  })

  it('400 — окончательный ответ по строке: остальные уходят, ничего не возвращается', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({ chatId: '555' })
    const tg = fakeTelegram(400, 200)
    deliverNotifications([money(), money()])
    await drainDeliveries(1000)
    expect(tg).toHaveLength(2)
    expect(releasesOf(db)).toHaveLength(0)
    expect(db.calls.some((c) => c.op === 'update' && c.table === 'users')).toBe(false)
  })

  it('5xx возвращает текущую и оставшиеся строки и прерывает пачку', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const [first, second, third] = [money(), money(), money()]
    const db = makeDb({ chatId: '555' })
    const tg = fakeTelegram(200, 502)
    deliverNotifications([first, second, third])
    await drainDeliveries(1000)
    expect(tg).toHaveLength(2)
    const back = releasesOf(db)
    expect(back).toHaveLength(1)
    expect(render(back[0]!.where).params).toEqual(['telegram', second.id, third.id])
    expect(db.claimed).toEqual(new Set([`${first.id}:telegram`]))
  })

  it('429 возвращает строки и выключает канал на retry_after', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const [first, second] = [money(), money()]
    const db = makeDb({ chatId: '555' })
    const tg = fakeTelegram({ status: 429, retryAfter: 40 })
    deliverNotifications([first, second])
    await drainDeliveries(1000)
    expect(tg).toHaveLength(1)
    expect(render(releasesOf(db)[0]!.where).params).toEqual(['telegram', first.id, second.id])
    expect(db.claimed.size).toBe(0)

    // Пока пауза не кончилась, Telegram не занимается и sweeper его не ищет.
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 39_000)
    const paused = makeDb({ chatId: '555' })
    deliverNotifications([money()])
    await drainDeliveries(1000)
    expect(paused.calls).toHaveLength(0)
    await sweepUndelivered()
    expect(paused.calls).toHaveLength(0)

    clock.mockReturnValue(now + 41_000)
    const resumed = makeDb({ chatId: '555', sweep: [first] })
    const tgAgain = fakeTelegram(200)
    await sweepUndelivered()
    await drainDeliveries(1000)
    expect(render(resumed.calls[0]!.where).sql).toContain('telegram_chat_id')
    expect(tgAgain).toHaveLength(1)
    clock.mockRestore()
  })

  it('между сообщениями одному чату есть пауза', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    _setTelegramChatGapForTest(60)
    makeDb({ chatId: '555' })
    const tg = fakeTelegram(200)
    deliverNotifications([money(), money()])
    await drainDeliveries(2000)
    expect(tg.at).toHaveLength(2)
    expect(tg.at[1]! - tg.at[0]!).toBeGreaterThanOrEqual(55)
  })

  it('обрыв сети на середине возвращает только неотправленное', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const first = money()
    const second = money()
    const db = makeDb({ chatId: '555' })
    fakeTelegram(200, new Error('network down'))
    deliverNotifications([first, second])
    await drainDeliveries(1000)
    const back = releasesOf(db)
    expect(back).toHaveLength(1)
    expect(render(back[0]!.where).params).toEqual(['telegram', second.id])
    expect(db.claimed).toEqual(new Set([`${first.id}:telegram`]))
  })

  it('сбой Telegram не дублирует пуш при досылке sweeper-ом', async () => {
    const n = money()
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], chatId: '555' })
    const pushes = fakeSender()
    const tg = fakeTelegram(new Error('network down'))
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(pushes).toHaveLength(1)
    expect(tg).toHaveLength(1)
    expect(db.claimed).toEqual(new Set([`${n.id}:push`]))

    // Sweeper находит строку (Telegram без отметки) и отдает ее обоим каналам, но пуш уже
    // занят, поэтому уходит только Telegram.
    const retry = makeDb({
      subs: [sub(1, 'https://push.example/a')],
      chatId: '555',
      sweep: [n],
      claimed: [...db.claimed],
    })
    const tgRetry = fakeTelegram(200)
    await sweepUndelivered()
    await drainDeliveries(1000)
    expect(pushes).toHaveLength(1)
    expect(tgRetry).toHaveLength(1)
    expect(retry.claimed).toEqual(new Set([`${n.id}:push`, `${n.id}:telegram`]))
  })

  it('база не отдала chat id: Telegram не занят, пуш при этом ушел', async () => {
    const n = money()
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')], chatId: new Error('db down') })
    const pushes = fakeSender()
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(pushes).toHaveLength(1)
    expect(db.claimed).toEqual(new Set([`${n.id}:push`]))
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.channel_failed', channel: 'telegram' }),
      expect.any(String),
    )
  })
})

describe('sweepUndelivered', () => {
  it('ищет строки моложе 15 минут, где у применимого канала нет отметки (критерий 6i)', async () => {
    const pending = row()
    const db = makeDb({ sweep: [pending], subs: [sub(1, 'https://push.example/a')] })
    const sent = fakeSender()
    await sweepUndelivered()
    await drainDeliveries(1000)

    const where = render(db.calls[0]!.where)
    expect(where.sql).toMatch(/"created_at" > now\(\) - make_interval\(mins => \$1\)/)
    expect(where.sql).toMatch(/"created_at" < now\(\) - make_interval\(secs => \$2\)/)
    expect(where.params.slice(0, 2)).toEqual([15, 10])
    // Отметка ищется по своему каналу, подключенность — по подпискам и chat id.
    expect(where.sql.match(/not exists \(select 1 from "notification_deliveries"/g)).toHaveLength(2)
    expect(where.sql).toContain('exists (select 1 from "push_subscriptions"')
    expect(where.sql).toContain('"users"."telegram_chat_id" is not null')
    expect(where.params).toContain('push')
    expect(where.params).toContain('telegram')
    // Каждый тип идет в обе ветки: и в push, и в Telegram.
    const count = (t: string) => where.params.filter((p) => p === t).length
    expect(count('booking.assigned')).toBe(2)
    expect(count('payout.changed')).toBe(2)
    expect(sent).toHaveLength(1)
  })

  it('без VAPID ищет только Telegram', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const db = makeDb({})
    await sweepUndelivered()
    const where = render(db.calls[0]!.where)
    expect(where.sql).not.toContain('push_subscriptions')
    expect(where.params).toContain('booking.assigned')
  })

  it('без базы не запускается', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const db = makeDb({})
    await sweepUndelivered()
    expect(db.calls).toHaveLength(0)
  })

  it('медленная отправка дольше 10 с: sweeper ту же строку второй раз не шлет', async () => {
    const n = row()
    const db = makeDb({ subs: [sub(1, 'https://push.example/a')] })
    let release = () => {}
    const sent: string[] = []
    _setPushSenderForTest(async (s) => {
      sent.push(s.endpoint)
      await new Promise<void>((r) => (release = r))
      return { statusCode: 201, body: '', headers: {} }
    })
    deliverNotifications([n])
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    // Пока первая отправка висит, sweeper находит ту же строку, но INSERT отметки ее уже
    // не отдает: канал занят первым отправителем.
    const sweep = makeDb({
      subs: [sub(1, 'https://push.example/a')],
      sweep: [n],
      claimed: [...db.claimed],
    })
    await sweepUndelivered()
    release()
    await drainDeliveries(1000)
    expect(sent).toHaveLength(1)
    expect(claimsOf(sweep, 'push')).toHaveLength(1)
  })
})
