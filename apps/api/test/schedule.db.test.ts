import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
  },
}))

import type { Db } from '../src/db/client.js'
import { ScheduleError, applyScheduleDays } from '../src/db/schedule.js'

// Thenable-фейк: select-запросы по очереди забирают `selects`, вставки и удаления
// только запоминаются.
function fakeTx(selects: unknown[]) {
  const queue = [...selects]
  const writes: string[] = []
  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'orderBy', 'values', 'onConflictDoNothing']) c[m] = () => c
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return c
  }
  const tx = {
    select: () => chain(() => queue.shift()),
    insert: () => chain(() => writes.push('insert')),
    delete: () => chain(() => writes.push('delete')),
  }
  return { tx: tx as unknown as Db, writes }
}

// 2026-11-29 — воскресенье, 2026-11-23 — понедельник.
const weekdaysOnly = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, opensAt: 600, closesAt: 1200 }))

describe('applyScheduleDays и режим студии', () => {
  it('не ставит рабочий день в выходной студии и ничего не пишет', async () => {
    const { tx, writes } = fakeTx([[{ id: 1 }], weekdaysOnly, []])
    const err = await applyScheduleDays(tx, [
      { masterId: 1, date: '2026-11-23', working: true },
      { masterId: 1, date: '2026-11-29', working: true },
    ]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ScheduleError)
    expect(err).toMatchObject({ code: 'studio_closed', dates: ['2026-11-29'] })
    expect(writes).toEqual([])
  })

  it('снять день в выходной студии можно', async () => {
    const { tx, writes } = fakeTx([[{ id: 1 }], weekdaysOnly])
    await applyScheduleDays(tx, [{ masterId: 1, date: '2026-11-29', working: false }])
    expect(writes).toEqual(['delete'])
  })

  it('пока режим не задан, ограничений нет', async () => {
    const { tx, writes } = fakeTx([[{ id: 1 }], [], []])
    await applyScheduleDays(tx, [{ masterId: 1, date: '2026-11-29', working: true }])
    expect(writes).toEqual(['insert'])
  })

  it('не ставит рабочий день на разовый выходной', async () => {
    const { tx, writes } = fakeTx([[{ id: 1 }], [], [{ date: '2026-12-31' }]])
    const err = await applyScheduleDays(tx, [
      { masterId: 1, date: '2026-12-31', working: true },
    ]).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'studio_closed', dates: ['2026-12-31'] })
    expect(writes).toEqual([])
  })
})
