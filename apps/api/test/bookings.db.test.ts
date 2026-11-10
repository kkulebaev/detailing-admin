import { describe, it, expect, vi, afterEach } from 'vitest'

// Тестируемый маппер чистый, но импорт db/bookings.js тянет db/client.js → env.js.
// Подменяем client, чтобы цепочка env вообще не загружалась.
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

// db/bookings.js теперь импортирует логгер (сбои junction пишут warning);
// подменяем его, чтобы цепочка env не загружалась, а warn можно было проверить.
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

const ACTOR = { id: 'u1', login: 'admin', name: 'Админ' }

describe('bookingToDbRow', () => {
  it('маппит однодневную запись с ISO-датами и снимком телефона в E.164', () => {
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

  it('сохраняет dateTo/timeTo и формулу суммы для многодневной записи', () => {
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

  it('пробрасывает пустую ссылку на клиента и по умолчанию делает note пустым', () => {
    const row = bookingToDbRow(makeBooking(), { ...META, clientId: null })
    expect(row.clientId).toBeNull()
    expect(row.note).toBe('')
  })

  it('записывает id-ссылку на машину из meta (в том числе null, если она не найдена)', () => {
    expect(bookingToDbRow(makeBooking(), META).carId).toBe('car-1')
    expect(bookingToDbRow(makeBooking(), { ...META, carId: null }).carId).toBeNull()
  })

  it('записывает переданный responsibleId, а без него по умолчанию ставит null', () => {
    expect(bookingToDbRow(makeBooking(), META, 7).responsibleId).toBe(7)
    expect(bookingToDbRow(makeBooking(), META).responsibleId).toBeNull()
  })
})

describe('фильтр по мастеру в listBookings', () => {
  // Thenable-заглушка query builder с очередью результатов на каждый await: каждый
  // метод цепочки возвращает `this`, а каждый await терминала резолвит следующий
  // результат из очереди. Порядок запросов при фильтре по мастеру: resolveMasterIds,
  // items, count. Каждый вызов `.where()` запоминает свое условие для проверки.
  function fakeDb(selectResults: unknown[], captured: unknown[], ordered: unknown[][] = []) {
    const q = [...selectResults]
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: (w: unknown) => {
        captured.push(w)
        return chain
      },
      orderBy: (...cols: unknown[]) => {
        ordered.push(cols)
        return chain
      },
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(q.shift() ?? []),
    }
    return chain
  }

  const renderAll = (captured: unknown[]) =>
    captured.filter((c) => c !== undefined).map((c) => new PgDialect().sqlToQuery(c as never))

  it('откатывается на проверку `= ANY(master)`, если имя не резолвится в id', async () => {
    const captured: unknown[] = []
    // resolveMasterIds → [] (неизвестное имя); items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(fakeDb([[], [], [{ count: 0 }]], captured) as never)

    await listBookings({ limit: 10, offset: 0, master: 'Петр' })

    const rendered = renderAll(captured)
    const anyClause = rendered.find((r) => r.sql.includes('= ANY'))
    expect(anyClause).toBeTruthy()
    expect(anyClause!.sql).toContain('"master"')
    expect(anyClause!.params).toContain('Петр')
    // id не найден → нет ветки EXISTS по junction.
    expect(rendered.some((r) => /exists/i.test(r.sql))).toBe(false)
  })

  it('ищет в junction по найденному id (находит записи после переименования) плюс запасной вариант по снимку', async () => {
    const captured: unknown[] = []
    // resolveMasterIds → id 9; items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(
      fakeDb([[{ id: 9, name: 'Петр' }], [], [{ count: 0 }]], captured) as never,
    )

    await listBookings({ limit: 10, offset: 0, master: 'Петр' })

    const rendered = renderAll(captured)
    const idClause = rendered.find((r) => /exists/i.test(r.sql) && r.sql.includes('= ANY'))
    expect(idClause).toBeTruthy()
    // EXISTS по junction с найденным id ИЛИ имя из снимка.
    expect(idClause!.sql).toContain('booking_masters')
    expect(idClause!.params).toContain(9)
    expect(idClause!.params).toContain('Петр')
  })

  it('не строит where, если фильтры не заданы', async () => {
    const captured: unknown[] = []
    // Нет фильтра по мастеру → нет resolveMasterIds; items → []; count → 0.
    vi.mocked(getDb).mockReturnValue(fakeDb([[], [{ count: 0 }]], captured) as never)

    await listBookings({ limit: 10, offset: 0 })

    // where равен undefined → заглушку все равно вызывают с undefined.
    expect(captured[0]).toBeUndefined()
  })

  it.each([
    [undefined, 'desc'],
    ['desc', 'desc'],
    ['asc', 'asc'],
  ] as const)('сортирует по дате, затем по времени создания, sort=%s → %s', async (sort, dir) => {
    const ordered: unknown[][] = []
    vi.mocked(getDb).mockReturnValue(fakeDb([[], [{ count: 0 }]], [], ordered) as never)

    await listBookings({ limit: 10, offset: 0, sort })

    const sqls = ordered[0].map((c) => new PgDialect().sqlToQuery(c as never).sql)
    expect(sqls).toEqual([`"bookings"."date_from" ${dir}`, `"bookings"."created_at" ${dir}`])
  })
})

describe('withLiveMasterNames (обогащение при чтении через listBookings)', () => {
  // Очередь результатов на каждый await, покрывающая всю цепочку чтения. Порядок
  // запросов без фильтра по мастеру: items, count, связи junction, имена ответственных.
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

  it('накладывает актуальные имена из junction (переименование видно по всей истории)', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row({ responsibleId: 7 })], // items
        [{ count: 1 }], // count
        [
          { bookingId: 'bk1', position: 0, name: 'Живое А' },
          { bookingId: 'bk1', position: 1, name: 'Живое Б' },
        ], // связи junction
        [{ id: 7, name: 'Живой Отв' }], // имена ответственных
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    expect(items[0].master).toEqual(['Живое А', 'Живое Б'])
    expect(items[0].responsible).toBe('Живой Отв')
  })

  it('расставляет актуальные имена по position независимо от порядка строк', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row()], // items (responsibleId равен null → без запроса ответственного)
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

  it('берет снимок для несопоставленного слота и для ответственного с null', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row()], // responsibleId равен null
        [{ count: 1 }],
        [{ bookingId: 'bk1', position: 0, name: 'Живое А' }], // связан только слот 0
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    // Слот 0 → актуальное, слот 1 → снимок; у ответственного нет id → снимок.
    expect(items[0].master).toEqual(['Живое А', 'Снимок Б'])
    expect(items[0].responsible).toBe('Снимок Отв')
  })

  it('берет ответственного из снимка, если id больше не резолвится', async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [row({ responsibleId: 99 })],
        [{ count: 1 }],
        [], // нет связей junction
        [], // id ответственного 99 ни во что не резолвится (удален)
      ]) as never,
    )

    const { items } = await listBookings({ limit: 10, offset: 0 })
    expect(items[0].master).toEqual(['Снимок А', 'Снимок Б'])
    expect(items[0].responsible).toBe('Снимок Отв')
  })
})

// Thenable-фейк query builder с очередями результатов на каждую операцию. Терминальные
// методы возвращают `this`; await резолвит следующий результат из очереди операции,
// с которой началась цепочка. `Error` в очереди insert/delete приводит к reject (имитация
// сбоя junction). Данные `.values()` и вызовы delete запоминаются.
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
    c.for = passthrough
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
      Promise.resolve().then(resolve).then(res, rej)
    return c
  }

  const pull = (q: unknown[]) => {
    const r = q.shift()
    if (r instanceof Error) throw r
    return r ?? []
  }

  const db: Record<string, unknown> = {
    // Транзакция выполняет колбэк на том же фейке: очереди общие.
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
    select: () => chain(() => pull(selectQ)),
    insert: () => chain(() => pull(insertQ)),
    update: () => chain(() => pull(updateQ)),
    delete: () => {
      capture.deletes++
      return chain(() => pull(deleteQ))
    },
  }

  return { db: db as unknown as ReturnType<typeof getDb>, capture }
}

afterEach(() => {
  vi.mocked(baseLogger.warn).mockClear()
})

describe('id-ссылка на мастера в insertBooking', () => {
  it('записывает responsible_id и по одной строке junction на каждого найденного мастера (не на ответственного)', async () => {
    const { db, capture } = makeWriteDb({
      // resolveMasterIds → оба имени известны.
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
      ],
      // insert в bookings возвращает новый id; insert в junction резолвится пустым.
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const ok = await insertBooking(makeBooking(), META)
    expect(ok).toBe(true)

    // Первый insert — строка bookings с найденным id ответственного.
    expect((capture.inserts[0] as Record<string, unknown>).responsibleId).toBe(2)
    // Второй insert — junction: только назначенный мастер (id 1), но не мастер, который
    // лишь ответственный (id 2); position привязывает его к слоту 0 снимка.
    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('пропускает строку junction для несопоставленного имени мастера', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
      ],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    await insertBooking(makeBooking({ master: ['Мастер А', 'Неизвестный'] }), META)

    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('привязывает position к слоту снимка, даже если предыдущий мастер не сопоставлен', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
      ],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    // 'Мастер Б' стоит в слоте 1 (слот 0 не сопоставлен) → position должен быть 1, а не 0.
    await insertBooking(makeBooking({ master: ['Неизвестный', 'Мастер Б'] }), META)

    expect(capture.inserts[1]).toEqual([{ bookingId: 'bk1', masterId: 2, position: 1 }])
  })

  it('не трогает junction, когда конфликт ничего не вставил (повтор после TTL)', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
      ],
      // Конфликт → id не возвращается.
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const ok = await insertBooking(makeBooking(), META)
    expect(ok).toBe(false)
    // Выполнился только insert в bookings; insert в junction не было.
    expect(capture.inserts).toHaveLength(1)
  })

  it('ставит responsible_id в null, если имя ответственного неизвестно', async () => {
    const { db, capture } = makeWriteDb({
      selectResults: [[{ id: 1, name: 'Мастер А' }]],
      insertResults: [[{ id: 'bk1' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    await insertBooking(makeBooking(), META)
    expect((capture.inserts[0] as Record<string, unknown>).responsibleId).toBeNull()
  })
})

describe('id-ссылка на мастера в updateBooking', () => {
  it('атомарно обновляет responsible_id и перезаписывает junction (delete + повторный insert)', async () => {
    const updatedRow = { id: 'bk1', master: ['Мастер А'] }
    const { db, capture } = makeWriteDb({
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
        [updatedRow],
      ],
      updateResults: [[updatedRow]],
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9', ACTOR)
    expect(row).toEqual(updatedRow)
    // Поля, клиент, машина и id ответственного выставляются в одном атомарном update.
    expect(capture.sets[0]).toMatchObject({
      clientId: 'client-1',
      carId: 'car-9',
      responsibleId: 2,
    })
    // Старые связи очищены, найденный мастер вставлен заново со своей позицией из снимка.
    expect(capture.deletes).toBe(1)
    expect(capture.inserts[0]).toEqual([{ bookingId: 'bk1', masterId: 1, position: 0 }])
  })

  it('возвращает обновленную строку, даже если перезапись junction падает (best-effort)', async () => {
    const updatedRow = { id: 'bk1', master: ['Мастер А'] }
    const { db } = makeWriteDb({
      selectResults: [
        [
          { id: 1, name: 'Мастер А' },
          { id: 2, name: 'Мастер Б' },
        ],
        [updatedRow],
      ],
      updateResults: [[updatedRow]],
      // Повторный insert в junction отклоняется.
      insertResults: [new Error('junction insert failed')],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9', ACTOR)
    // Инвариант PATCH: обновление полей сохраняется; сбой проглатывается и логируется.
    expect(row).toEqual(updatedRow)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.junction_update_failed' }),
      expect.any(String),
    )
  })

  it('возвращает строку с актуальными именами мастеров из перезаписанного junction', async () => {
    const updatedRow = {
      id: 'bk1',
      master: ['Снимок А'],
      responsible: 'Снимок Отв',
      responsibleId: null,
    }
    const { db } = makeWriteDb({
      // [0] resolveMasterIds, [1] блокировка строки, [2] связи junction для обогащения.
      selectResults: [
        [{ id: 1, name: 'Мастер А' }],
        [updatedRow],
        [{ bookingId: 'bk1', position: 0, name: 'Живое А' }],
      ],
      updateResults: [[updatedRow]],
      insertResults: [[]],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('bk1', makeBooking(), 'client-1', 'car-9', ACTOR)
    // Возвращенная строка несет текущее имя мастера, а не снимок.
    expect(row?.master).toEqual(['Живое А'])
  })

  it('возвращает null (и пропускает junction), если ни одна запись не соответствует id', async () => {
    const { db, capture } = makeWriteDb({
      // Блокировка не нашла строку → update не выполняется.
      selectResults: [[{ id: 1, name: 'Мастер А' }], []],
    })
    vi.mocked(getDb).mockReturnValue(db)

    const row = await updateBooking('missing', makeBooking(), null, null, ACTOR)
    expect(row).toBeNull()
    expect(capture.deletes).toBe(0)
    expect(capture.inserts).toHaveLength(0)
  })
})

describe('миграция 0017: ссылка car_id', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../drizzle/0017_curvy_saracen.sql'),
    'utf-8',
  )

  it('добавляет nullable-колонку car_id', () => {
    expect(sql).toMatch(/ADD COLUMN "car_id" uuid;/)
  })

  it('обнуляет car_id при удалении машины, чтобы строка со снимком пережила обычное редактирование клиента', () => {
    expect(sql).toMatch(/bookings_car_id_client_cars_id_fk[\s\S]*?ON DELETE set null/)
  })

  it('индексирует car_id для будущего чтения записей по машине', () => {
    expect(sql).toMatch(/CREATE INDEX "bookings_car_id_idx" ON "bookings"[\s\S]*?"car_id"/)
  })
})

describe('миграция 0016: семантика onDelete', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../drizzle/0016_first_penance.sql'),
    'utf-8',
  )

  it('каскадирует оба FK junction, чтобы удаления подчищали id-ссылки', () => {
    expect(sql).toMatch(/booking_masters_booking_id_bookings_id_fk[\s\S]*?ON DELETE cascade/)
    expect(sql).toMatch(/booking_masters_master_id_masters_id_fk[\s\S]*?ON DELETE cascade/)
  })

  it('обнуляет responsible_id при удалении мастера, чтобы строка со снимком сохранилась', () => {
    expect(sql).toMatch(/bookings_responsible_id_masters_id_fk[\s\S]*?ON DELETE set null/)
  })

  it('задает junction составной первичный ключ', () => {
    expect(sql).toContain('PRIMARY KEY("booking_id","master_id")')
  })

  it('содержит колонку position, чтобы сторона чтения могла привязать актуальное имя к слоту', () => {
    expect(sql).toMatch(/"position" smallint DEFAULT 0 NOT NULL/)
  })
})

describe('backfillMasterIds', () => {
  // Фейк tagged template: записывает каждый запрос (с плейсхолдерами `?`) и резолвится
  // в следующий результат из очереди, дополненный `.count` в стиле postgres-js, чтобы
  // скрипт мог прочитать число затронутых строк.
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

  it('выполняет идемпотентные запросы: нормализация split + junction с ON CONFLICT DO NOTHING + update ответственного с WHERE-null', async () => {
    const { backfillMasterIds } = await importBackfill()
    // 5 запросов: нормализация split, insert в junction, update ответственного, 2 диагностических select несопоставленных.
    const { tag, calls } = fakeSql([[], [], [], [], []])

    await backfillMasterIds(tag as never)

    expect(calls).toHaveLength(5)
    // Нормализация идет первой, чтобы junction/обогащение видели одно имя на слот.
    expect(calls[0]).toContain('UPDATE bookings')
    expect(calls[0]).toContain('string_to_array')
    expect(calls[0]).toContain('IS DISTINCT FROM')
    expect(calls[1]).toContain('INSERT INTO booking_masters')
    expect(calls[1]).toContain('ON CONFLICT (booking_id, master_id) DO NOTHING')
    expect(calls[2]).toContain('UPDATE bookings')
    expect(calls[2]).toContain('responsible_id IS NULL')
  })

  it('сообщает число нормализованных/сопоставленных и несопоставленные имена', async () => {
    const { backfillMasterIds } = await importBackfill()
    const { tag } = fakeSql([
      [{}, {}], // нормализовано 2 массива мастеров
      [{}, {}, {}], // вставлено 3 связи junction
      [{}], // привязан 1 ответственный
      [{ name: 'Призрак' }], // несопоставленный мастер
      [], // нет несопоставленных ответственных
    ])

    const res = await backfillMasterIds(tag as never)
    expect(res.arraysNormalized).toBe(2)
    expect(res.linksInserted).toBe(3)
    expect(res.responsibleLinked).toBe(1)
    expect(res.unmatchedMasters).toEqual(['Призрак'])
    expect(res.unmatchedResponsible).toEqual([])
  })

  it('идемпотентен: повторный запуск выполняет те же самые запросы', async () => {
    const { backfillMasterIds } = await importBackfill()
    const first = fakeSql([[], [], [], [], []])
    const second = fakeSql([[], [], [], [], []])

    await backfillMasterIds(first.tag as never)
    await backfillMasterIds(second.tag as never)

    expect(second.calls).toEqual(first.calls)
  })
})

describe('backfillCarIds', () => {
  // Тот же фейк tagged template, что и в backfillMasterIds: записывает запросы
  // (с плейсхолдерами `?`) и резолвится в следующий результат из очереди с `.count`
  // в стиле postgres-js.
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

  it('выполняет идемпотентный UPDATE (car_id IS NULL, join по нормализованному ключу в пределах клиента) + SELECT остатка', async () => {
    const { backfillCarIds } = await importBackfill()
    const { tag, calls } = fakeSql([[], [{ count: 0 }]])

    await backfillCarIds(tag as never)

    expect(calls).toHaveLength(2)
    // UPDATE связи: join по нормализованному ключу, тот же клиент, только строки с NULL.
    expect(calls[0]).toContain('UPDATE bookings')
    expect(calls[0]).toContain('SET car_id')
    expect(calls[0]).toContain('cc.client_id = bb.client_id')
    expect(calls[0]).toContain('regexp_replace')
    expect(calls[0]).toContain('DISTINCT ON (bb.id)')
    expect(calls[0]).toContain('bb.car_id IS NULL')
    expect(calls[0]).toContain('b.car_id IS NULL')
    // Диагностический подсчет только читает.
    expect(calls[1]).toContain('SELECT count(*)')
    expect(calls[1]).toContain('b.car_id IS NULL')
  })

  it('сообщает число привязанных и еще доступных для привязки', async () => {
    const { backfillCarIds } = await importBackfill()
    // UPDATE привязал 2 строки; 3 еще можно привязать, но они не привязаны.
    const { tag } = fakeSql([[{}, {}], [{ count: 3 }]])

    const res = await backfillCarIds(tag as never)
    expect(res.linked).toBe(2)
    expect(res.remainingLinkable).toBe(3)
  })

  it('идемпотентен: повторный запуск выполняет те же самые запросы', async () => {
    const { backfillCarIds } = await importBackfill()
    const first = fakeSql([[], [{ count: 0 }]])
    const second = fakeSql([[], [{ count: 0 }]])

    await backfillCarIds(first.tag as never)
    await backfillCarIds(second.tag as never)

    expect(second.calls).toEqual(first.calls)
  })
})
