import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { getDb } from '../src/db/client.js'
import {
  deleteExpiredPushSubscriptions,
  deletePushSubscription,
  hasPushSubscription,
  upsertPushSubscription,
} from '../src/notifications/push-subscriptions.js'

function makeDb(selectResult: unknown[] = []) {
  const captured: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'limit', 'returning']) c[m] = () => c
  c.where = (w: unknown) => {
    captured.where = w
    return c
  }
  c.values = (v: unknown) => {
    captured.values = v
    return c
  }
  c.onConflictDoUpdate = (v: unknown) => {
    captured.conflict = v
    return c
  }
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(selectResult).then(res)
  vi.mocked(getDb).mockReturnValue({
    select: () => c,
    insert: () => c,
    delete: () => c,
  } as never)
  return captured
}

const render = (w: unknown) => new PgDialect().sqlToQuery(w as never)
const ENDPOINT = 'https://push.example/abc'

beforeEach(() => vi.mocked(getDb).mockReset())

describe('push_subscriptions', () => {
  it('upsert по endpoint перевешивает подписку на текущий аккаунт и его сессию', async () => {
    const captured = makeDb()
    const expiresAt = new Date('2026-12-01T00:00:00.000Z')
    await upsertPushSubscription('u-new', {
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      userAgent: 'UA',
      expiresAt,
    })
    expect(captured.values).toEqual({
      userId: 'u-new',
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      userAgent: 'UA',
      expiresAt,
    })
    expect(captured.conflict).toMatchObject({
      target: expect.objectContaining({ name: 'endpoint' }),
      set: { userId: 'u-new', p256dh: 'p', auth: 'a', userAgent: 'UA', expiresAt },
    })
  })

  it('проверка текущей подписки видит только свою и с живой сессией', async () => {
    const captured = makeDb([])
    expect(await hasPushSubscription('u-emp', ENDPOINT)).toBe(false)
    const where = render(captured.where)
    expect(where.sql).toMatch(/"user_id" = \$1 and "push_subscriptions"."endpoint" = \$2/)
    // Истекшая строка — «не подписан».
    expect(where.sql).toContain('"push_subscriptions"."expires_at" > now()')
    expect(where.params).toEqual(['u-emp', ENDPOINT])

    makeDb([{ id: 1 }])
    expect(await hasPushSubscription('u-emp', ENDPOINT)).toBe(true)
  })

  it('удаление не трогает чужую подписку с тем же endpoint', async () => {
    const captured = makeDb()
    await deletePushSubscription('u-emp', ENDPOINT)
    expect(render(captured.where).params).toEqual(['u-emp', ENDPOINT])
  })

  it('уборка удаляет подписки истекших сессий', async () => {
    const captured = makeDb([{ id: 1 }, { id: 2 }])
    expect(await deleteExpiredPushSubscriptions()).toBe(2)
    expect(render(captured.where).sql).toBe('"push_subscriptions"."expires_at" < now()')
  })
})
