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

import type { WorkRule } from '@detailing-admin/shared'
import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  WorkRuleError,
  replaceMasterWorkRules,
  rowToRule,
  ruleToRow,
} from '../src/db/work-rules.js'

// Thenable-фейк транзакции: select-запросы по очереди забирают `selects`, вставка
// возвращает переданные строки, как `returning()` у Postgres.
function fakeDb(selects: unknown[]) {
  const queue = [...selects]
  const deleted: unknown[] = []
  const inserted: Record<string, unknown>[][] = []
  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'for', 'innerJoin', 'orderBy']) c[m] = () => c
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return c
  }
  const tx = {
    select: () => chain(() => queue.shift()),
    delete: () => chain(() => deleted.push(true)),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        inserted.push(rows)
        return { returning: () => Promise.resolve(rows) }
      },
    }),
  }
  const db = { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as Db
  return { db, deleted, inserted }
}

const percent: WorkRule = { sectionId: 1, serviceId: null, kind: 'percent', percent: 40 }
const fixed: WorkRule = {
  sectionId: null,
  serviceId: 7,
  kind: 'fixed',
  fixedByClass: [80, 100, 120, 150],
}

describe('ruleToRow / rowToRule', () => {
  it('переводят правило в строку и обратно без потерь', () => {
    for (const r of [percent, fixed]) {
      expect(rowToRule(ruleToRow(3, r) as Parameters<typeof rowToRule>[0])).toEqual({
        masterId: 3,
        ...r,
      })
    }
  })

  it('у процента нет сумм фикса, у фикса нет процента (их требуют CHECK)', () => {
    expect(ruleToRow(3, percent)).toMatchObject({
      percent: 40,
      fixedClass1: null,
      fixedClass4: null,
    })
    expect(ruleToRow(3, fixed)).toMatchObject({ percent: null, fixedClass1: 80, fixedClass4: 150 })
  })
})

describe('replaceMasterWorkRules', () => {
  it('стирает старые правила и вставляет новые', async () => {
    const { db, deleted, inserted } = fakeDb([[{ id: 3 }], [{ id: 1 }], [{ id: 7 }]])
    _setDbForTest(db)
    const saved = await replaceMasterWorkRules(3, [percent, fixed])
    expect(deleted).toHaveLength(1)
    expect(inserted[0]).toHaveLength(2)
    expect(saved).toEqual([
      { masterId: 3, ...percent },
      { masterId: 3, ...fixed },
    ])
  })

  it('пустой список только стирает', async () => {
    const { db, deleted, inserted } = fakeDb([[{ id: 3 }]])
    _setDbForTest(db)
    expect(await replaceMasterWorkRules(3, [])).toEqual([])
    expect(deleted).toHaveLength(1)
    expect(inserted).toHaveLength(0)
  })

  it('архивный или неизвестный мастер → master_not_found, ничего не стерто', async () => {
    const { db, deleted } = fakeDb([[]])
    _setDbForTest(db)
    await expect(replaceMasterWorkRules(3, [percent])).rejects.toMatchObject({
      code: 'master_not_found',
    })
    expect(deleted).toHaveLength(0)
  })

  it('услуги нет в прайсе → unknown_target с путем поля, ничего не стерто', async () => {
    const { db, deleted } = fakeDb([[{ id: 3 }], [{ id: 1 }], []])
    _setDbForTest(db)
    const err = await replaceMasterWorkRules(3, [percent, fixed]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkRuleError)
    expect(err).toMatchObject({ code: 'unknown_target', path: ['rules', 1, 'serviceId'] })
    expect(deleted).toHaveLength(0)
  })
})
