import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))
vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))
vi.mock('../src/boot.js', () => ({ isDbReady: vi.fn().mockReturnValue(true) }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { isDbReady } from '../src/boot.js'
import { getDb } from '../src/db/client.js'
import type { Tx } from '../src/db/audit.js'
import { baseLogger } from '../src/log.js'
import { createScheduleRequest, decideScheduleRequest } from '../src/db/schedule-requests.js'
import { deleteOldNotifications, startNotificationsCleanup } from '../src/notifications/cleanup.js'
import {
  insertNotifications,
  listNotifications,
  markNotificationRead,
  notifyMoney,
} from '../src/notifications/store.js'

// Thenable-фейк query builder: await каждой цепочки забирает следующий результат из
// очереди своей операции; `Error` в очереди — отказ запроса. Транзакция и точка
// сохранения выполняют колбэк на том же фейке. Условия where и вставки запоминаются.
function makeDb(opts: {
  select?: unknown[]
  insert?: unknown[]
  update?: unknown[]
  del?: unknown[]
  savepointFails?: boolean
}) {
  const queues = {
    select: [...(opts.select ?? [])],
    insert: [...(opts.insert ?? [])],
    update: [...(opts.update ?? [])],
    delete: [...(opts.del ?? [])],
  }
  const captured = {
    values: [] as unknown[],
    sets: [] as unknown[],
    wheres: [] as unknown[],
    orders: [] as unknown[][],
  }
  const chain = (q: unknown[]) => {
    const c: Record<string, unknown> = {}
    const pass = () => c
    for (const m of ['from', 'innerJoin', 'limit', 'for', 'returning']) c[m] = pass
    c.where = (w: unknown) => {
      captured.wheres.push(w)
      return c
    }
    c.orderBy = (...cols: unknown[]) => {
      captured.orders.push(cols)
      return c
    }
    c.values = (v: unknown) => {
      captured.values.push(v)
      return c
    }
    c.set = (v: unknown) => {
      captured.sets.push(v)
      return c
    }
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const r = q.shift()
          if (r instanceof Error) throw r
          return r ?? []
        })
        .then(res, rej)
    return c
  }
  let depth = 0
  const db: Record<string, unknown> = {
    transaction: async (fn: (tx: unknown) => unknown) => {
      depth++
      try {
        // Вложенная транзакция — точка сохранения.
        if (depth > 1 && opts.savepointFails) throw new Error('savepoint failed')
        return await fn(db)
      } finally {
        depth--
      }
    },
    select: () => chain(queues.select),
    insert: () => chain(queues.insert),
    update: () => chain(queues.update),
    delete: () => chain(queues.delete),
  }
  return { db, captured }
}

const render = (w: unknown) => new PgDialect().sqlToQuery(w as never)

afterEach(() => {
  vi.mocked(baseLogger.warn).mockClear()
})

describe('insertNotifications', () => {
  it('вставляет черновики одной вставкой и возвращает строки', async () => {
    const { db, captured } = makeDb({ insert: [[{ id: 1 }]] })
    const drafts = [
      {
        userId: 'u',
        type: 'payout.changed' as const,
        title: 't',
        body: 'b',
        link: null,
        pushBody: null,
      },
    ]
    const rows = await insertNotifications(db as unknown as Tx, async () => drafts)
    expect(rows).toEqual([{ id: 1 }])
    expect(captured.values).toEqual([drafts])
  })

  it('без черновиков в базу не ходит', async () => {
    const { db, captured } = makeDb({})
    expect(await insertNotifications(db as unknown as Tx, async () => [])).toEqual([])
    expect(captured.values).toEqual([])
  })

  it('сбой поиска получателей или вставки глотается с notification.insert_failed (6g)', async () => {
    const { db } = makeDb({})
    const rows = await insertNotifications(db as unknown as Tx, async () => {
      throw new Error('lookup failed')
    })
    expect(rows).toEqual([])
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.insert_failed', message: 'lookup failed' }),
      expect.any(String),
    )
  })
})

describe('notifyMoney', () => {
  it('выплата, созданная админом, — мастеру payout.changed с суммой (критерий 6)', async () => {
    const { db, captured } = makeDb({
      select: [[{ masterId: 4, userId: 'u-emp', role: 'employee' }]],
      insert: [[]],
    })
    await notifyMoney(db as unknown as Tx, 'u-admin', 4, {
      type: 'payout.changed',
      action: 'create',
      payout: { payoutDate: '2026-11-20', amount: 3000, note: '' },
    })
    expect(captured.values).toMatchObject([
      [
        {
          userId: 'u-emp',
          type: 'payout.changed',
          title: 'Новая выплата',
          body: expect.stringMatching(/^3\s000 ₽ · 20\.11\.2026$/),
          link: '/employee',
        },
      ],
    ])
  })

  it('неизвестная роль аккаунта сводится к employee', async () => {
    const { db, captured } = makeDb({
      select: [[{ masterId: 4, userId: 'u-x', role: 'superuser' }]],
      insert: [[]],
    })
    await notifyMoney(db as unknown as Tx, 'u-admin', 4, {
      type: 'work_hours.changed',
      action: 'delete',
      hours: { workDate: '2026-11-20', minutes: 60 },
    })
    expect(captured.values).toMatchObject([[{ link: '/employee' }]])
  })
})

describe('лента', () => {
  it('идет по id от новых к старым, курсор before — строго меньше (критерий 7)', async () => {
    const { db, captured } = makeDb({ select: [[]] })
    vi.mocked(getDb).mockReturnValue(db as never)
    await listNotifications('u1', { limit: 30, before: 50 })
    const where = render(captured.wheres[0])
    expect(where.sql).toMatch(/"user_id" = \$1 and "notifications"."id" < \$2/)
    expect(where.params).toEqual(['u1', 50])
    expect(render(captured.orders[0]![0]).sql).toBe('"notifications"."id" desc')
  })

  it('прочтение ограничено своим аккаунтом; ничего не обновлено — false', async () => {
    const { db, captured } = makeDb({ update: [[]] })
    vi.mocked(getDb).mockReturnValue(db as never)
    expect(await markNotificationRead('u1', 7)).toBe(false)
    const where = render(captured.wheres[0])
    expect(where.params).toEqual([7, 'u1'])
  })
})

describe('заявки на график', () => {
  it('новая заявка — уведомление каждому админу, у автора нет (критерий 5)', async () => {
    const { db, captured } = makeDb({
      select: [[{ name: 'Иван' }], [], [{ id: 'u-admin' }, { id: 'u-admin2' }]],
      insert: [[{ id: 3, masterId: 7, status: 'pending', days: [], createdAt: new Date() }], []],
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    await createScheduleRequest(7, [{ date: '2026-11-25', working: true }], 'u-emp')
    expect(captured.values[1]).toMatchObject([
      { userId: 'u-admin', type: 'schedule_request.created' },
      { userId: 'u-admin2', type: 'schedule_request.created' },
    ])
  })

  const pending = {
    id: 3,
    masterId: 7,
    status: 'pending',
    days: [{ date: '2026-11-25', working: true }],
  }
  const admin = { id: 'u-admin', login: 'admin', name: 'Анна' }

  it('решение получает аккаунт мастера на момент решения (5, 6f)', async () => {
    const { db, captured } = makeDb({
      // Заявка, затем текущая привязка мастера — уже другой аккаунт.
      select: [[pending], [{ userId: 'u-new' }]],
      update: [[]],
      insert: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    await decideScheduleRequest(3, admin, { approve: false, comment: 'Не выйдет' })
    expect(captured.values).toMatchObject([
      [{ userId: 'u-new', type: 'schedule_request.decided', body: 'Причина: Не выйдет' }],
    ])
  })

  it('сбой уведомлений не откатывает решение (6g)', async () => {
    const { db, captured } = makeDb({
      select: [[pending], [{ userId: 'u-emp' }]],
      update: [[]],
      savepointFails: true,
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    await expect(
      decideScheduleRequest(3, admin, { approve: false, comment: null }),
    ).resolves.toBeUndefined()
    expect(captured.sets).toMatchObject([{ status: 'rejected' }])
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.insert_failed' }),
      expect.any(String),
    )
  })
})

describe('cleanup', () => {
  it('удаляет уведомления старше 90 дней (критерий 12)', async () => {
    const { db, captured } = makeDb({ del: [[{ id: 1 }, { id: 2 }]] })
    vi.mocked(getDb).mockReturnValue(db as never)
    expect(await deleteOldNotifications()).toBe(2)
    const where = render(captured.wheres[0])
    expect(where.sql).toBe('"notifications"."created_at" < now() - make_interval(days => $1)')
    expect(where.params).toEqual([90])
  })

  it('без базы пропускает запуск, таймер не держит процесс', () => {
    vi.mocked(isDbReady).mockReturnValueOnce(false)
    vi.mocked(getDb).mockClear()
    const timer = startNotificationsCleanup()
    clearInterval(timer)
    expect(vi.mocked(getDb)).not.toHaveBeenCalled()
    expect(timer.hasRef()).toBe(false)
  })
})
