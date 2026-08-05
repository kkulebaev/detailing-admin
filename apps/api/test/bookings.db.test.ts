import { describe, it, expect, vi, afterEach } from 'vitest'

// The mapper under test is pure, but importing db/bookings.js pulls db/client.js
// → env.js. Stub the client so the env chain never loads.
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

// db/bookings.js now imports the logger (junction failures log a warning);
// stub it so the env chain never loads and the warn is inspectable.
vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToDbRow, insertBooking, listBookings, updateBooking } from '../src/db/bookings.js'
import { getDb } from '../src/db/client.js'
import { baseLogger } from '../src/log.js'

function makeBooking(over: Record<string, unknown> = {}) {
  return bookingSchema.parse({
    dateFrom: '04.06.2026',
    time: '10:00',
    name: 'Иван',
    phone: '8 (900) 123-45-67',
    car: 'Toyota Camry',
    service: 'Полировка',
    amount: 5000,
    master: ['Мастер А'],
    responsible: 'Мастер Б',
    carClass: 3,
    ...over,
  })
}

const META = {
  idempotencyKey: 'k1',
  clientId: 'c1' as string | null,
  carId: 'car-1' as string | null,
  sheetRow: 5 as number | null,
  sheetRange: 'Запись 2026!A5' as string | null,
}

describe('bookingToDbRow', () => {
  it('maps a single-day booking with ISO dates and an E.164 phone snapshot', () => {
    const row = bookingToDbRow(makeBooking(), META)
    expect(row).toMatchObject({
      idempotencyKey: 'k1',
      clientId: 'c1',
      name: 'Иван',
      phone: '+79001234567',
      car: 'Toyota Camry',
      service: 'Полировка',
      amount: 5000,
      amountFormula: null,
      dateFrom: '2026-06-04',
      dateTo: null,
      timeFrom: '10:00',
      timeTo: null,
      carClass: 3,
      carId: 'car-1',
      sheetRow: 5,
      sheetRange: 'Запись 2026!A5',
    })
  })

  it('keeps dateTo/timeTo and the amount formula for a multi-day booking', () => {
    const row = bookingToDbRow(
      makeBooking({ dateTo: '06.06.2026', timeTo: '18:00', amountFormula: '=2000+3000' }),
      META,
    )
    expect(row.dateFrom).toBe('2026-06-04')
    expect(row.dateTo).toBe('2026-06-06')
    expect(row.timeFrom).toBe('10:00')
    expect(row.timeTo).toBe('18:00')
    expect(row.amountFormula).toBe('=2000+3000')
  })

  it('carries a null client link through and defaults note to empty', () => {
    const row = bookingToDbRow(makeBooking(), { ...META, clientId: null })
    expect(row.clientId).toBeNull()
    expect(row.note).toBe('')
  })

  it('writes the car id-link from meta (including a null when unresolved)', () => {
    expect(bookingToDbRow(makeBooking(), META).carId).toBe('car-1')
    expect(bookingToDbRow(makeBooking(), { ...META, carId: null }).carId).toBeNull()
  })

  it('writes the passed responsibleId and defaults it to null when omitted', () => {
    expect(bookingToDbRow(makeBooking(), META, 7).responsibleId).toBe(7)
    expect(bookingToDbRow(makeBooking(), META).responsibleId).toBeNull()
  })
})

describe('listBookings master filter', () => {
  // A thenable query-builder stub with a per-await result queue: every chain
  // method returns `this`, and each awaited terminal resolves the next queued
  // result. Query order for a master filter is: resolveMasterIds, items, count.
  // Each `.where()` call records its condition for inspection.
  function fakeDb(selectResults: unknown[], captured: unknown[]) {
    const q = [...selectResults]
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: (w: unknown) => {
        captured.push(w)
        return chain
      },
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(q.shift() ?? []),
    }
    return chain
  }

  const renderAll = (captured: unknown[]) =>
    captured
      .filter((c) => c !== undefined)
      .map((c) => new PgDialect().sqlToQuery(c as never))

  it('falls back to `= ANY(master)` membership when the name resolves to no id', async () => {
    const captured: unknown[] = []
    // resolveMasterIds → [] (unknown name); items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(fakeDb([[], [], [{ count: 0 }]], captured) as never)

    await listBookings({ limit: 10, offset: 0, master: 'Пётр' })

    const rendered = renderAll(captured)
    const anyClause = rendered.find((r) => r.sql.includes('= ANY'))
    expect(anyClause).toBeTruthy()
    expect(anyClause!.sql).toContain('"master"')
    expect(anyClause!.params).toContain('Пётр')
    // No id resolved → no junction EXISTS branch.
    expect(rendered.some((r) => /exists/i.test(r.sql))).toBe(false)
  })

  it('matches the junction by resolved id (finds records after a rename) plus the snapshot fallback', async () => {
    const captured: unknown[] = []
    // resolveMasterIds → id 9; items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(
      fakeDb([[{ id: 9, name: 'Пётр' }], [], [{ count: 0 }]], captured) as never,
    )

    await listBookings({ limit: 10, offset: 0, master: 'Пётр' })

    const rendered = renderAll(captured)
    const idClause = rendered.find((r) => /exists/i.test(r.sql) && r.sql.includes('= ANY'))
    expect(idClause).toBeTruthy()
    // EXISTS against the junction on the resolved id, OR the snapshot name.
    expect(idClause!.sql).toContain('booking_masters')
    expect(idClause!.params).toContain(9)
    expect(idClause!.params).toContain('Пётр')
  })

  it('builds no where clause when no filters are given', async () => {
    const captured: unknown[] = []
    // No master filter → no resolveMasterIds; items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(fakeDb([[], [{ count: 0 }]], captured) as never)

    await listBookings({ limit: 10, offset: 0 })

    // undefined where → the stub still gets called with undefined.
    expect(captured[0]).toBeUndefined()
  })
})

describe('withLiveMasterNames (read enrichment via listBookings)', () => {
  // Per-await result queue supporting the full read chain. Query order with no
  // master filter: items, count, junction links, responsible names.
  function fakeDb(selectResults: unknown[]) {
    const q = [...selectResults]
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(q.shift() ?? []),
    }
    return chain
  }

  function row(over: Record<string, unknown> = {}) {
    return {
      id: 'bk1',
      master: ['Снимок А', 'Снимок Б'],
      responsible: 'Снимок Отв',
      responsibleId: null as number | null,
      ...over,
    }
  }

  it('overlays live names from the junction (rename reflects across history)', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row({ responsibleId: 7 })], // items
        [{ count: 1 }], // count
        [
          { bookingId: 'bk1', position: 0, name: 'Живое А' },
          { bookingId: 'bk1', position: 1, name: 'Живое Б' },
        ], // junction links
        [{ id: 7, name: 'Живой Отв' }], // responsible names
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    expect(items[0].master).toEqual(['Живое А', 'Живое Б'])
    expect(items[0].responsible).toBe('Живой Отв')
  })

  it('places live names by position regardless of row order', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row()], // items (responsibleId null → no responsible query)
        [{ count: 1 }],
        [
          { bookingId: 'bk1', position: 1, name: 'Живое Б' },
          { bookingId: 'bk1', position: 0, name: 'Живое А' },
        ],
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    expect(items[0].master).toEqual(['Живое А', 'Живое Б'])
  })

  it('falls back to the snapshot for an unmatched slot and a null responsible', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row()], // responsibleId null
        [{ count: 1 }],
        [{ bookingId: 'bk1', position: 0, name: 'Живое А' }], // only slot 0 linked
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    // Slot 0 → live, slot 1 → snapshot; responsible has no id → snapshot.
    expect(items[0].master).toEqual(['Живое А', 'Снимок Б'])
    expect(items[0].responsible).toBe('Снимок Отв')
  })

  it('falls back to the snapshot responsible when the id no longer resolves', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row({ responsibleId: 99 })],
        [{ count: 1 }],
        [], // no junction links
        [], // responsible id 99 resolves to nothing (deleted)
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    expect(items[0].master).toEqual(['Снимок А', 'Снимок Б'])
    expect(items[0].responsible).toBe('Снимок Отв')
  })
})

// A thenable query-builder fake with per-operation result queues. Terminal
// methods return `this`; awaiting resolves the next queued result for the op that
// started the chain. An `Error` in an insert/delete queue rejects (to simulate a
// junction failure). `.values()` payloads and delete calls are captured.
interface WriteCapture {
  inserts: Array<Record<string, unknown> | Array<Record<string, unknown>>>
  sets: Array<Record<string, unknown>>
  deletes: number
}

function makeWriteDb(opts: {
  selectResults?: unknown[]
  insertResults?: unknown[]
  updateResults?: unknown[]
  deleteResults?: unknown[]
}): { db: ReturnType<typeof getDb>; capture: WriteCapture } {
  const selectQ = [...(opts.selectResults ?? [])]
  const insertQ = [...(opts.insertResults ?? [])]
  const updateQ = [...(opts.updateResults ?? [])]
  const deleteQ = [...(opts.deleteResults ?? [])]
  const capture: WriteCapture = { inserts: [], sets: [], deletes: 0 }

  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.from = passthrough
    c.innerJoin = passthrough
    c.where = passthrough
    c.orderBy = passthrough
    c.limit = passthrough
    c.returning = passthrough
    c.onConflictDoNothing = passthrough
    c.set = (v: Record<string, unknown>) => {
      capture.sets.push(v)
      return c
    }
    c.values = (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
      capture.inserts.push(v)
      return c
    }
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(resolve)
        .then(res, rej)
    return c
  }

  const pull = (q: unknown[]) => {
    const r = q.shift()
    if (r instanceof Error) throw r
    return r ?? []
  }

  const db = {
    select: () => chain(() => pull(selectQ)),
    insert: () => chain(() => pull(insertQ)),
    update: () => chain(() => pull(updateQ)),
    delete: () => {
      capture.deletes++
      return chain(() => pull(deleteQ))
    },
  } as unknown as ReturnType<typeof getDb>

  return { db, capture }
}

afterEach(() => {
  vi.mocked(baseLogger.warn).mockClear()
})

describe('insertBooking master id-link', () => {
  it('writes responsible_id and one junction row per matched master (not the responsible)', async () => {
    const { db, capture } = makeWriteDb({
      // resolveMasterIds → both names known.
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      // bookings insert returns the new id; junction insert resolves empty.
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const ok = await insertBooking(makeBooking(), META)
    expect(ok).toBe(true)

    // First insert is the bookings row, carrying the resolved responsible id.
    expect((capture.inserts[0] as Record<string, unknown>).responsibleId).toBe(2)
    // Second insert is the junction: only the assigned master (id 1), never the
    // responsible-only master (id 2); position anchors it to snapshot slot 0.
    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('skips the junction row for an unmatched master name', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    await insertBooking(makeBooking({ master: ['Мастер А', 'Неизвестный'] }), META)

    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('anchors position to the snapshot slot even when an earlier master is unmatched', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    // 'Мастер Б' sits at slot 1 (slot 0 is unmatched) → position must be 1, not 0.
    await insertBooking(makeBooking({ master: ['Неизвестный', 'Мастер Б'] }), META)

    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 2, position: 1 }])
  })

  it('does not touch the junction on a conflict no-op (post-TTL retry)', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      // Conflict → no returned id.
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const ok = await insertBooking(makeBooking(), META)
    expect(ok).toBe(false)
    // Only the bookings insert ran; no junction insert.
    expect(capture.inserts).toHaveLength(1)
  })

  it('sets responsible_id to null when the responsible name is unknown', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }]],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    await insertBooking(makeBooking(), META)
    expect((capture.inserts[0] as Record<string, unknown>).responsibleId).toBeNull()
  })
})

describe('updateBooking master id-link', () => {
  it('refreshes responsible_id atomically and rewrites the junction (delete + reinsert)', async () => {
    const updatedRow = { id: 'bk1', master: ['Мастер А'] }
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      updateResults: [[updatedRow]],
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9')
    expect(row).toEqual(updatedRow)
    // Fields + client + car + responsible id all set in the same atomic update.
    expect(capture.sets[0]).toMatchObject({
      clientId: 'client-1',
      carId: 'car-9',
      responsibleId: 2,
    })
    // Old links cleared, matched master re-inserted with its snapshot position.
    expect(capture.deletes).toBe(1)
    expect(capture.inserts[0]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('returns the updated row even when the junction rewrite throws (best-effort)', async () => {
    const updatedRow = { id: 'bk1', master: ['Мастер А'] }
    const { db } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }, { id: 2, name: 'Мастер Б' }]],
      updateResults: [[updatedRow]],
      // Junction re-insert rejects.
      insertResults: [new Error('junction insert failed')],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9')
    // PATCH invariant: the field update stands; the failure is swallowed + logged.
    expect(row).toEqual(updatedRow)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.junction_update_failed' }),
      expect.any(String),
    )
  })

  it('returns the row with live master names overlaid from the rewritten junction', async () => {
    const updatedRow = {
      id: 'bk1',
      master: ['Снимок А'],
      responsible: 'Снимок Отв',
      responsibleId: null,
    }
    const { db } = makeWriteDb({
      // [0] resolveMasterIds, [1] enrichment junction links (post-rewrite).
      selectResults: [
        [{ id: 1, name: 'Мастер А' }],
        [{ bookingId: 'bk1', position: 0, name: 'Живое А' }],
      ],
      updateResults: [[updatedRow]],
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9')
    // The returned row carries the current master name, not the snapshot.
    expect(row?.master).toEqual(['Живое А'])
  })

  it('returns null (and skips the junction) when no booking matches the id', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }]],
      updateResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('missing', makeBooking(), null, null)
    expect(row).toBeNull()
    expect(capture.deletes).toBe(0)
    expect(capture.inserts).toHaveLength(0)
  })
})

describe('0017 migration car_id link', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../drizzle/0017_curvy_saracen.sql'),
    'utf-8',
  )

  it('adds a nullable car_id column', () => {
    expect(sql).toMatch(/ADD COLUMN "car_id" uuid;/)
  })

  it('nulls car_id on car delete so the snapshot row survives a routine client edit', () => {
    expect(sql).toMatch(
      /bookings_car_id_client_cars_id_fk[\s\S]*?ON DELETE set null/,
    )
  })

  it('indexes car_id for a future car→bookings reader', () => {
    expect(sql).toMatch(/CREATE INDEX "bookings_car_id_idx" ON "bookings"[\s\S]*?"car_id"/)
  })
})

describe('0016 migration onDelete semantics', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../drizzle/0016_first_penance.sql'),
    'utf-8',
  )

  it('cascades both junction FKs so deletes clean up the id-links', () => {
    expect(sql).toMatch(
      /booking_masters_booking_id_bookings_id_fk[\s\S]*?ON DELETE cascade/,
    )
    expect(sql).toMatch(
      /booking_masters_master_id_masters_id_fk[\s\S]*?ON DELETE cascade/,
    )
  })

  it('nulls responsible_id on master delete so the snapshot row survives', () => {
    expect(sql).toMatch(
      /bookings_responsible_id_masters_id_fk[\s\S]*?ON DELETE set null/,
    )
  })

  it('gives the junction a composite primary key', () => {
    expect(sql).toContain('PRIMARY KEY("booking_id","master_id")')
  })

  it('carries a position column so the read side can anchor a live name to its slot', () => {
    expect(sql).toMatch(/"position" smallint DEFAULT 0 NOT NULL/)
  })
})

describe('backfillMasterIds', () => {
  // Tagged-template fake: records each statement (with `?` placeholders) and
  // resolves to the next queued result, augmented with a postgres-js-style
  // `.count` so the script can read affected-row counts.
  function fakeSql(results: unknown[][]) {
    const calls: string[] = []
    let i = 0
    const withCount = (rows: unknown[]) => Object.assign([...rows], { count: rows.length })
    const tag = (strings: TemplateStringsArray, ..._args: unknown[]) => {
      calls.push(strings.join('?').replace(/\s+/g, ' ').trim())
      return Promise.resolve(withCount(results[i++] ?? []))
    }
    return { tag, calls }
  }

  async function importBackfill() {
    return import('../scripts/backfill-master-ids.js')
  }

  it('issues idempotent statements: split normalize + ON CONFLICT DO NOTHING junction + WHERE-null responsible update', async () => {
    const { backfillMasterIds } = await importBackfill()
    // 5 statements: normalize split, junction insert, responsible update, 2 unmatched-diagnostic selects.
    const { tag, calls } = fakeSql([[], [], [], [], []])

    await backfillMasterIds(tag as never)

    expect(calls).toHaveLength(5)
    // Normalize is first so the junction/enrichment see one name per slot.
    expect(calls[0]).toContain('UPDATE bookings')
    expect(calls[0]).toContain('string_to_array')
    expect(calls[0]).toContain('IS DISTINCT FROM')
    expect(calls[1]).toContain('INSERT INTO booking_masters')
    expect(calls[1]).toContain('ON CONFLICT (booking_id, master_id) DO NOTHING')
    expect(calls[2]).toContain('UPDATE bookings')
    expect(calls[2]).toContain('responsible_id IS NULL')
  })

  it('reports normalized/matched counts and unmatched names', async () => {
    const { backfillMasterIds } = await importBackfill()
    const { tag } = fakeSql([
      [{}, {}], // 2 master arrays normalized
      [{}, {}, {}], // 3 junction links inserted
      [{}], // 1 responsible linked
      [{ name: 'Призрак' }], // unmatched master
      [], // no unmatched responsible
    ])

    const res = await backfillMasterIds(tag as never)
    expect(res.arraysNormalized).toBe(2)
    expect(res.linksInserted).toBe(3)
    expect(res.responsibleLinked).toBe(1)
    expect(res.unmatchedMasters).toEqual(['Призрак'])
    expect(res.unmatchedResponsible).toEqual([])
  })

  it('is idempotent: a second run issues the identical statements', async () => {
    const { backfillMasterIds } = await importBackfill()
    const first = fakeSql([[], [], [], [], []])
    const second = fakeSql([[], [], [], [], []])

    await backfillMasterIds(first.tag as never)
    await backfillMasterIds(second.tag as never)

    expect(second.calls).toEqual(first.calls)
  })
})

describe('backfillCarIds', () => {
  // Same tagged-template fake as backfillMasterIds: records statements (with `?`
  // placeholders) and resolves to the next queued result with a postgres-js-style
  // `.count`.
  function fakeSql(results: unknown[][]) {
    const calls: string[] = []
    let i = 0
    const withCount = (rows: unknown[]) => Object.assign([...rows], { count: rows.length })
    const tag = (strings: TemplateStringsArray, ..._args: unknown[]) => {
      calls.push(strings.join('?').replace(/\s+/g, ' ').trim())
      return Promise.resolve(withCount(results[i++] ?? []))
    }
    return { tag, calls }
  }

  async function importBackfill() {
    return import('../scripts/backfill-car-ids.js')
  }

  it('issues an idempotent UPDATE (car_id IS NULL, same-client normalized-key join) + a remaining-count SELECT', async () => {
    const { backfillCarIds } = await importBackfill()
    const { tag, calls } = fakeSql([[], [{ count: 0 }]])

    await backfillCarIds(tag as never)

    expect(calls).toHaveLength(2)
    // The link UPDATE: normalized-key join, same client, only NULL rows.
    expect(calls[0]).toContain('UPDATE bookings')
    expect(calls[0]).toContain('SET car_id')
    expect(calls[0]).toContain('cc.client_id = bb.client_id')
    expect(calls[0]).toContain('regexp_replace')
    expect(calls[0]).toContain('DISTINCT ON (bb.id)')
    expect(calls[0]).toContain('bb.car_id IS NULL')
    expect(calls[0]).toContain('b.car_id IS NULL')
    // The diagnostic count is read-only.
    expect(calls[1]).toContain('SELECT count(*)')
    expect(calls[1]).toContain('b.car_id IS NULL')
  })

  it('reports linked and remaining-linkable counts', async () => {
    const { backfillCarIds } = await importBackfill()
    // 2 rows linked by the UPDATE; 3 still linkable-but-unlinked.
    const { tag } = fakeSql([[{}, {}], [{ count: 3 }]])

    const res = await backfillCarIds(tag as never)
    expect(res.linked).toBe(2)
    expect(res.remainingLinkable).toBe(3)
  })

  it('is idempotent: a second run issues the identical statements', async () => {
    const { backfillCarIds } = await importBackfill()
    const first = fakeSql([[], [{ count: 0 }]])
    const second = fakeSql([[], [{ count: 0 }]])

    await backfillCarIds(first.tag as never)
    await backfillCarIds(second.tag as never)

    expect(second.calls).toEqual(first.calls)
  })
})
