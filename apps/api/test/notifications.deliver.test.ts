import { describe, it, expect, vi, beforeEach } from 'vitest'

// Изменяемый env: часть тестов проверяет поведение без VAPID.
const envMock = vi.hoisted(() => ({
  VAPID_PUBLIC_KEY: 'BPublic' as string | undefined,
  VAPID_PRIVATE_KEY: 'private' as string | undefined,
  VAPID_SUBJECT: 'mailto:owner@example.com' as string | undefined,
}))

vi.mock('../src/env.js', () => ({ env: envMock }))
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))
vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))
vi.mock('../src/boot.js', () => ({ isDbReady: vi.fn().mockReturnValue(true) }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { WebPushError, type RequestOptions } from 'web-push'
import { isDbReady } from '../src/boot.js'
import { getDb } from '../src/db/client.js'
import type { NotificationRow, PushSubscriptionRow } from '../src/db/schema.js'
import { baseLogger } from '../src/log.js'
import {
  deliverNotifications,
  drainDeliveries,
  sweepUndelivered,
} from '../src/notifications/deliver.js'
import { _setPushSenderForTest } from '../src/notifications/web-push.js'

// Thenable-фейк query builder, как в notifications.store.test: каждый await цепочки
// забирает следующий результат из очереди своей операции. UPDATE, ставящий deliveredAt,
// по умолчанию занимает все переданные id; `taken` — id, уже занятые другим отправителем.
function makeDb(opts: {
  select?: unknown[]
  taken?: number[]
  failClaim?: boolean
  failRelease?: boolean
}) {
  const selects = [...(opts.select ?? [])]
  const calls: { op: string; where?: unknown; set?: Record<string, unknown> }[] = []
  const chain = (op: string, next: (call: (typeof calls)[number]) => unknown) => {
    const call: (typeof calls)[number] = { op }
    calls.push(call)
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'orderBy', 'limit', 'returning']) c[m] = () => c
    c.where = (w: unknown) => {
      call.where = w
      return c
    }
    c.set = (v: Record<string, unknown>) => {
      call.set = v
      return c
    }
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => next(call))
        .then(res, rej)
    return c
  }
  const db = {
    select: () => chain('select', () => selects.shift() ?? []),
    delete: () => chain('delete', () => []),
    update: () =>
      chain('update', (call) => {
        if (call.set && 'deliveredAt' in call.set) {
          if (call.set.deliveredAt === null) {
            if (opts.failRelease) throw new Error('db down')
            return []
          }
          if (opts.failClaim) throw new Error('db down')
          const ids = render(call.where).params.filter((p) => typeof p === 'number')
          return ids.filter((id) => !opts.taken?.includes(id)).map((id) => ({ id }))
        }
        return []
      }),
  }
  vi.mocked(getDb).mockReturnValue(db as never)
  return calls
}

const claims = (calls: ReturnType<typeof makeDb>) =>
  calls.filter((c) => c.op === 'update' && c.set?.deliveredAt instanceof Date)
const releases = (calls: ReturnType<typeof makeDb>) =>
  calls.filter((c) => c.op === 'update' && c.set?.deliveredAt === null)

const render = (w: unknown) => new PgDialect().sqlToQuery(w as never)

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
  deliveredAt: null,
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

beforeEach(() => {
  envMock.VAPID_PUBLIC_KEY = 'BPublic'
  envMock.VAPID_PRIVATE_KEY = 'private'
  envMock.VAPID_SUBJECT = 'mailto:owner@example.com'
  vi.mocked(isDbReady).mockReturnValue(true)
  vi.mocked(getDb).mockReset()
  vi.mocked(baseLogger.info).mockClear()
  vi.mocked(baseLogger.warn).mockClear()
})

describe('deliverNotifications — Web Push', () => {
  it('шлет на все подписки, payload без имени клиента у booking.* (критерий 6l)', async () => {
    const calls = makeDb({ select: [[sub(1, 'https://push.example/a')], [{ count: 3 }]] })
    const sent = fakeSender()
    const n = row()
    deliverNotifications([n])
    await drainDeliveries(1000)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toEqual({
      title: 'Новая запись',
      body: '26.11, 10:00 · Kia Rio · Полировка',
      link: '/bookings?booking=bk1',
      tag: expect.any(String),
      unread: 3,
    })
    expect(JSON.stringify(sent[0]!.payload)).not.toContain('Иван')
    expect(sent[0]!.options).toMatchObject({ TTL: 86400, topic: sent[0]!.payload.tag })
    expect(String(sent[0]!.options.topic)).toMatch(/^[A-Za-z0-9_-]{1,32}$/)

    // Строка занимается условным UPDATE до отправки, успех отмечает подписку.
    expect(calls[0]!.op).toBe('update')
    const claim = render(claims(calls)[0]!.where)
    expect(claim.sql).toContain('"delivered_at" is null')
    expect(claim.params).toEqual([n.id])
    expect(calls.some((c) => c.set && 'lastSuccessAt' in c.set)).toBe(true)
    expect(releases(calls)).toHaveLength(0)
  })

  it('без pushBody в пуш идет body, без ссылки — лента', async () => {
    makeDb({ select: [[sub(1, 'https://push.example/a')], [{ count: 1 }]] })
    const sent = fakeSender()
    deliverNotifications([
      row({ type: 'payout.changed', pushBody: null, body: '3 000 ₽ · 20.11.2026', link: null }),
    ])
    await drainDeliveries(1000)
    expect(sent[0]!.payload).toMatchObject({ body: '3 000 ₽ · 20.11.2026', link: '/notifications' })
  })

  it('410 и 404 удаляют подписку, 500 — нет (критерий 10)', async () => {
    const calls = makeDb({
      select: [
        [
          sub(1, 'https://push.example/gone'),
          sub(2, 'https://push.example/missing'),
          sub(3, 'https://push.example/flaky'),
        ],
        [{ count: 1 }],
      ],
    })
    fakeSender((e) => (e.endsWith('gone') ? 410 : e.endsWith('missing') ? 404 : 500))
    deliverNotifications([row()])
    await drainDeliveries(1000)

    const deletes = calls.filter((c) => c.op === 'delete')
    expect(deletes).toHaveLength(1)
    expect(render(deletes[0]!.where).params).toEqual([1, 2])
    // 5xx — состоявшаяся попытка: строка остается занятой, sweeper ее не дошлет.
    expect(releases(calls)).toHaveLength(0)
  })

  it('в логах только тип, получатель и статус, без текста', async () => {
    makeDb({ select: [[sub(1, 'https://push.example/a')], [{ count: 1 }]] })
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
    const calls = makeDb({ select: [[sub(1, 'https://push.example/a')], [{ count: 1 }]] })
    fakeSender(() => new Error('socket hang up'))
    expect(() => deliverNotifications([row()])).not.toThrow()
    await drainDeliveries(1000)
    expect(releases(calls)).toHaveLength(0)
  })

  it('строку, уже занятую другим отправителем, не отправляет', async () => {
    const n = row()
    const calls = makeDb({ taken: [n.id] })
    const sent = fakeSender()
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(0)
  })

  it("если занять строку не удалось, ничего не шлет и оставляет ее sweeper'у", async () => {
    const calls = makeDb({ failClaim: true })
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(releases(calls)).toHaveLength(0)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.claim_failed' }),
      expect.any(String),
    )
  })

  it('сбой канала целиком (база не отдала подписки) возвращает строку в outbox', async () => {
    const n = row()
    const calls = makeDb({ select: [new Error('db down')] })
    const sent = fakeSender()
    deliverNotifications([n])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    const back = releases(calls)
    expect(back).toHaveLength(1)
    expect(render(back[0]!.where).params).toEqual([n.id])
  })

  it('без подписок пушей нет, но строка помечается доставленной', async () => {
    const calls = makeDb({ select: [[]] })
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(sent).toHaveLength(0)
    expect(claims(calls)).toHaveLength(1)
    expect(releases(calls)).toHaveLength(0)
  })

  it('без VAPID в базу не ходит вовсе (критерий 9)', async () => {
    envMock.VAPID_PRIVATE_KEY = undefined
    const calls = makeDb({})
    const sent = fakeSender()
    deliverNotifications([row()])
    await drainDeliveries(1000)
    expect(calls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })
})

describe('sweepUndelivered', () => {
  it('досылает только недоставленные моложе 15 минут (критерий 6i)', async () => {
    const pending = row()
    const calls = makeDb({
      select: [[pending], [sub(1, 'https://push.example/a')], [{ count: 1 }]],
    })
    const sent = fakeSender()
    await sweepUndelivered()
    await drainDeliveries(1000)

    const where = render(calls[0]!.where)
    expect(where.sql).toContain('"delivered_at" is null')
    expect(where.sql).toMatch(/"created_at" > now\(\) - make_interval\(mins => \$1\)/)
    expect(where.params[0]).toBe(15)
    expect(sent).toHaveLength(1)
  })

  it('без базы не запускается', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const calls = makeDb({})
    await sweepUndelivered()
    expect(calls).toHaveLength(0)
  })

  it('медленная отправка дольше 10 с: sweeper ту же строку второй раз не шлет', async () => {
    const n = row()
    makeDb({ select: [[sub(1, 'https://push.example/a')], [{ count: 1 }]] })
    let release = () => {}
    const sent: string[] = []
    _setPushSenderForTest(async (s) => {
      sent.push(s.endpoint)
      await new Promise<void>((r) => (release = r))
      return { statusCode: 201, body: '', headers: {} }
    })
    deliverNotifications([n])
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    // Пока первая отправка висит, sweeper находит ту же строку, но условный UPDATE
    // ее уже не отдает: deliveredAt проставлен первым отправителем.
    const sweepCalls = makeDb({ select: [[n]], taken: [n.id] })
    await sweepUndelivered()
    release()
    await drainDeliveries(1000)
    expect(sent).toHaveLength(1)
    expect(claims(sweepCalls)).toHaveLength(1)
  })
})
