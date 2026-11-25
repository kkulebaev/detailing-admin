import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { getDb } from '../src/db/client.js'
import {
  deletePushSubscription,
  hasPushSubscription,
  upsertPushSubscription,
} from '../src/notifications/push-subscriptions.js'

function makeDb(selectResult: unknown[] = []) {
  const captured: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'limit']) c[m] = () => c
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
  it('upsert по endpoint перевешивает подписку на текущий аккаунт', async () => {
    const captured = makeDb()
    await upsertPushSubscription('u-new', {
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      userAgent: 'UA',
    })
    expect(captured.values).toEqual({
      userId: 'u-new',
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      userAgent: 'UA',
    })
    expect(captured.conflict).toMatchObject({
      target: expect.objectContaining({ name: 'endpoint' }),
      set: { userId: 'u-new', p256dh: 'p', auth: 'a', userAgent: 'UA' },
    })
  })

  it('проверка текущей подписки видит только свою', async () => {
    const captured = makeDb([])
    expect(await hasPushSubscription('u-emp', ENDPOINT)).toBe(false)
    const where = render(captured.where)
    expect(where.sql).toMatch(/"user_id" = \$1 and "push_subscriptions"."endpoint" = \$2/)
    expect(where.params).toEqual(['u-emp', ENDPOINT])

    makeDb([{ id: 1 }])
    expect(await hasPushSubscription('u-emp', ENDPOINT)).toBe(true)
  })

  it('удаление не трогает чужую подписку с тем же endpoint', async () => {
    const captured = makeDb()
    await deletePushSubscription('u-emp', ENDPOINT)
    expect(render(captured.where).params).toEqual(['u-emp', ENDPOINT])
  })
})
