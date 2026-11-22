/**
 * Раскладывает услуги старых записей в `booking_services` и восстанавливает `discount`.
 * Записи, созданные формой с пикером услуг, хранят выбор только текстом: ячейку
 * «Услуга» (`Раздел: услуга, услуга ×2`) и формулу суммы (`=2000+1500*2-500`).
 * Скрипт разбирает обе строки и переносит запись, только если разбор однозначен и
 * формула сходится с `amount` до рубля. Все остальное остается текстом, как было.
 *
 *   pnpm --filter @detailing-admin/api backfill:booking-services            # dry-run
 *   pnpm --filter @detailing-admin/api backfill:booking-services --verbose  # + тексты пропущенных
 *   pnpm --filter @detailing-admin/api backfill:booking-services --apply
 *
 * Против прода: `DATABASE_URL=… pnpm …` (переменная окружения важнее .env). Перед
 * `--apply` снимите дамп: `pnpm --filter @detailing-admin/api db:backup`.
 *
 * Что меняет `--apply`, одной транзакцией:
 *   • вставляет строки в `booking_services` только записям, у которых строк еще нет;
 *   • ставит `bookings.discount` только там, где он сейчас 0.
 * `service`, `amount`, `amount_formula` и `note` не трогает. Записи разбираются
 * заново под `FOR UPDATE`, поэтому правка, пришедшая между dry-run и apply, не
 * смешается со старым разбором. Затронутые id и прежние скидки ложатся в таблицу
 * `_backfill_booking_services_<время>`; по ней печатается SQL отката. Повторный запуск
 * пропускает уже разложенные записи.
 */
import { pathToFileURL } from 'node:url'
import type { TransactionSql } from 'postgres'
import { bookingServiceLineSchema } from '@detailing-admin/shared/booking'
import { getSql, closeDb } from '../src/db/client.js'

export interface PricelistForParse {
  sections: { name: string; services: { id: number; name: string }[] }[]
}

export interface BookingForParse {
  service: string
  amount: number
  amountFormula: string | null
  note: string
}

export interface ParsedLine {
  serviceId: number | null
  section: string
  name: string
  price: number
  quantity: number
}

export type ParseResult =
  | { ok: true; lines: ParsedLine[]; discount: number }
  | { ok: false; reason: ParseFailure }

export type ParseFailure =
  | 'no_formula'
  | 'bad_formula'
  | 'unknown_section'
  | 'unknown_service'
  | 'ambiguous_service'
  | 'term_mismatch'
  | 'discount_mismatch'
  | 'amount_mismatch'
  | 'order_mismatch'
  | 'invalid_line'

interface Term {
  value: number
  qty: number | null
}

// Форма пишет формулу только из цифр, `+`, `-` и `*`; все остальное — не ее формула.
function parseFormula(formula: string): Term[] | null {
  const body = formula.replace(/\s+/g, '')
  if (!/^=\d+(\*\d+)?([+-]\d+(\*\d+)?)*$/.test(body)) return null
  const terms: Term[] = []
  for (const m of body.slice(1).matchAll(/([+-]?)(\d+)(?:\*(\d+))?/g)) {
    const value = Number(m[2]) * (m[1] === '-' ? -1 : 1)
    terms.push({ value, qty: m[3] === undefined ? null : Number(m[3]) })
  }
  return terms
}

interface Item {
  serviceId: number | null
  name: string
  quantity: number
}

/** Все способы прочесть список услуг раздела. Названия сами бывают с запятыми и
 * скобками, поэтому режем не по `, `, а подбираем известные названия раздела. */
function matchItems(rest: string, services: { id: number; name: string }[]): Item[][] {
  const out: Item[][] = []
  const walk = (pos: number, acc: Item[]) => {
    if (out.length > 1) return
    if (pos === rest.length) {
      if (acc.length > 0) out.push(acc)
      return
    }
    for (const svc of services) {
      if (!rest.startsWith(svc.name, pos)) continue
      let next = pos + svc.name.length
      let quantity = 1
      const qty = /^ ×(\d+)/.exec(rest.slice(next))
      if (qty) {
        quantity = Number(qty[1])
        next += qty[0].length
      }
      const item = { serviceId: svc.id, name: svc.name, quantity }
      if (next === rest.length) walk(next, [...acc, item])
      else if (rest.startsWith(', ', next)) walk(next + 2, [...acc, item])
    }
  }
  walk(0, [])
  return out
}

function splitItems(rest: string): Item[] | null {
  const items: Item[] = []
  for (const part of rest.split(', ')) {
    const m = /^(.*?)(?: ×(\d+))?$/.exec(part.trim())
    const name = m?.[1]?.trim() ?? ''
    if (name === '') return null
    items.push({ serviceId: null, name, quantity: m?.[2] ? Number(m[2]) : 1 })
  }
  return items
}

const RUB_DISCOUNT = /^Скидка (\d[\d\s]*) ₽$/m
const PCT_DISCOUNT = /^Скидка (\d{1,3})%$/m

export function parseBookingServices(
  b: BookingForParse,
  pricelist: PricelistForParse,
): ParseResult {
  if (!b.amountFormula) return { ok: false, reason: 'no_formula' }
  const terms = parseFormula(b.amountFormula)
  if (!terms) return { ok: false, reason: 'bad_formula' }

  const sections = [...pricelist.sections].sort((a, z) => z.name.length - a.name.length)
  const lines: ParsedLine[] = []
  // Раздел или услугу переименовали в прайсе после записи: такие строки читаем по
  // разделителям формы и оставляем без связи с прайсом, на снимке.
  let detached = false
  for (const raw of b.service.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const section = sections.find((s) => line.startsWith(`${s.name}: `))
    const sectionName = section?.name ?? line.slice(0, Math.max(0, line.indexOf(': ')))
    if (sectionName === '') return { ok: false, reason: 'unknown_section' }
    const rest = line.slice(sectionName.length + 2)
    const readings = section ? matchItems(rest, section.services) : []
    if (readings.length > 1) return { ok: false, reason: 'ambiguous_service' }
    const items = readings[0] ?? splitItems(rest)
    if (!items) return { ok: false, reason: section ? 'unknown_service' : 'unknown_section' }
    if (!readings[0]) detached = true
    for (const item of items) lines.push({ ...item, section: sectionName, price: 0 })
  }
  if (lines.length === 0) return { ok: false, reason: 'unknown_service' }
  // Пикер всегда перечислял услуги раздела в порядке прайса (по id). Другой порядок
  // значит, что текст правили руками, и слагаемые формулы могут принадлежать не тем услугам.
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]
    const cur = lines[i]
    if (prev.section !== cur.section || prev.serviceId == null || cur.serviceId == null) continue
    if (cur.serviceId <= prev.serviceId) return { ok: false, reason: 'order_mismatch' }
  }

  // Первые слагаемые — цены услуг в том же порядке, что и в ячейке: и ячейку, и формулу
  // форма строила из одной разбивки.
  if (terms.length < lines.length) return { ok: false, reason: 'term_mismatch' }
  for (const [i, line] of lines.entries()) {
    const term = terms[i]
    if (term.value < 0) return { ok: false, reason: 'term_mismatch' }
    const expectedQty = line.quantity > 1 ? line.quantity : null
    if (term.qty !== expectedQty) return { ok: false, reason: 'term_mismatch' }
    line.price = term.value
  }
  const subtotal = lines.reduce((acc, l) => acc + l.price * l.quantity, 0)

  // Хвост формулы: необязательная ручная поправка суммы, затем вычет скидки. Отличить
  // одно от другого по формуле нельзя — скидку выдает строка «Скидка …» в примечании.
  const tail = terms.slice(lines.length)
  if (tail.some((t) => t.qty !== null)) return { ok: false, reason: 'term_mismatch' }
  const rub = RUB_DISCOUNT.exec(b.note)
  const pct = PCT_DISCOUNT.exec(b.note)
  // Разбивку по `, ` без сверки с прайсом подтверждает только точное совпадение числа
  // слагаемых: лишнее слагаемое могло бы оказаться и ручной поправкой, и куском
  // названия с запятой.
  if (detached && tail.length !== (rub || pct ? 1 : 0)) {
    return { ok: false, reason: 'term_mismatch' }
  }
  let delta = 0
  let discount = 0
  if (rub || pct) {
    if (tail.length === 0 || tail.length > 2) return { ok: false, reason: 'discount_mismatch' }
    const last = tail[tail.length - 1]
    if (last.value >= 0) return { ok: false, reason: 'discount_mismatch' }
    discount = -last.value
    if (tail.length === 2) delta = tail[0].value
    const base = subtotal + delta
    const expected = rub
      ? Math.min(Number(rub[1].replace(/\s/g, '')), base)
      : Math.round((base * Math.min(Number(pct![1]), 100)) / 100)
    if (expected !== discount) return { ok: false, reason: 'discount_mismatch' }
  } else {
    if (tail.length > 1) return { ok: false, reason: 'term_mismatch' }
    if (tail.length === 1) delta = tail[0].value
  }

  if (Math.max(0, subtotal + delta - discount) !== b.amount) {
    return { ok: false, reason: 'amount_mismatch' }
  }
  // Строка, которую потом не пропустит схема, сломала бы следующее сохранение записи.
  if (lines.some((l) => !bookingServiceLineSchema.safeParse(l).success)) {
    return { ok: false, reason: 'invalid_line' }
  }
  return { ok: true, lines, discount }
}

type Sql = ReturnType<typeof getSql>
type Query = Sql | TransactionSql

interface CandidateRow {
  id: string
  service: string
  amount: number
  amount_formula: string | null
  note: string
  discount: number
  service_edited: boolean
}

async function loadPricelist(sql: Query): Promise<PricelistForParse> {
  const rows = await sql<{ section: string; id: number; name: string }[]>`
    SELECT s.name AS section, v.id, v.name
    FROM sections s JOIN services v ON v.section_id = s.id
    ORDER BY s.id, v.id
  `
  const bySection = new Map<string, { id: number; name: string }[]>()
  for (const r of rows) {
    const list = bySection.get(r.section) ?? []
    list.push({ id: r.id, name: r.name })
    bySection.set(r.section, list)
  }
  return { sections: [...bySection].map(([name, services]) => ({ name, services })) }
}

// Кандидаты — записи без строк услуг. Записи без формулы тоже попадают в отчет,
// чтобы было видно, сколько осталось текстом. `service_edited`: текст услуги правили в
// приложении. Правка, не менявшая сумму, оставляла прежнюю формулу, и та могла описывать
// уже другой список услуг; правки до появления журнала формулу всегда стирали.
function selectCandidates(sql: Query, lock: boolean) {
  return sql<CandidateRow[]>`
    SELECT b.id, b.service, b.amount, b.amount_formula, b.note, b.discount,
      EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.entity = 'booking' AND a.entity_id = b.id::text AND a.action = 'update'
          AND a.changes @> '[{"field": "service"}]'
      ) AS service_edited
    FROM bookings b
    WHERE NOT EXISTS (SELECT 1 FROM booking_services s WHERE s.booking_id = b.id)
    ORDER BY b.created_at
    ${lock ? sql`FOR UPDATE OF b` : sql``}
  `
}

type SkipReason = ParseFailure | 'has_discount' | 'service_edited'

interface Plan {
  ready: { row: CandidateRow; lines: ParsedLine[]; discount: number }[]
  skipped: Map<SkipReason, CandidateRow[]>
}

function plan(rows: CandidateRow[], pricelist: PricelistForParse): Plan {
  const ready: Plan['ready'] = []
  const skipped: Plan['skipped'] = new Map()
  const skip = (reason: SkipReason, row: CandidateRow) => {
    skipped.set(reason, [...(skipped.get(reason) ?? []), row])
  }
  for (const row of rows) {
    if (row.service_edited && row.amount_formula) {
      skip('service_edited', row)
      continue
    }
    const r = parseBookingServices(
      {
        service: row.service,
        amount: row.amount,
        amountFormula: row.amount_formula,
        note: row.note,
      },
      pricelist,
    )
    if (!r.ok) skip(r.reason, row)
    // Скидку уже кто-то выставил — не перетираем ее разбором.
    else if (row.discount !== 0) skip('has_discount', row)
    else ready.push({ row, lines: r.lines, discount: r.discount })
  }
  return { ready, skipped }
}

function report(p: Plan, total: number, verbose: boolean): void {
  const lines = p.ready.reduce((acc, r) => acc + r.lines.length, 0)
  const withDiscount = p.ready.filter((r) => r.discount > 0).length
  console.log(`Записей без строк услуг: ${total}`)
  console.log(`  разложатся: ${p.ready.length} (строк: ${lines}, со скидкой: ${withDiscount})`)
  for (const [reason, rows] of [...p.skipped].sort((a, z) => z[1].length - a[1].length)) {
    console.log(`  пропуск ${reason}: ${rows.length}`)
    if (verbose && reason !== 'no_formula') {
      for (const r of rows) {
        console.log(`    ${r.id}  ${r.amount_formula ?? '—'}  ${JSON.stringify(r.service)}`)
      }
    }
  }
  if (verbose) {
    for (const r of p.ready) {
      const items = r.lines.map((l) => `${l.name}×${l.quantity}=${l.price}`).join('; ')
      console.log(`  ✓ ${r.row.id}  ${items}${r.discount ? `  скидка ${r.discount}` : ''}`)
    }
  }
}

async function apply(sql: Sql, verbose: boolean): Promise<void> {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const backupTable = `_backfill_booking_services_${stamp}`
  const applied = await sql.begin(async (tx) => {
    // Пока идет запись, никто не добавит строки услуг сам: иначе запись, которую правка
    // успела разложить, осталась бы кандидатом (NOT EXISTS видит снимок до правки), и
    // вставка упала бы на ключе. Чтение таблицы не блокируется.
    await tx`LOCK TABLE booking_services IN SHARE ROW EXCLUSIVE MODE`
    const pricelist = await loadPricelist(tx)
    const rows = await selectCandidates(tx, true)
    const p = plan(rows, pricelist)
    report(p, rows.length, verbose)
    if (p.ready.length === 0) return 0

    const ids = p.ready.map((r) => r.row.id)
    await tx`
      CREATE TABLE ${tx(backupTable)} AS
      SELECT id AS booking_id, discount, now()::timestamp AS applied_at
      FROM bookings WHERE id = ANY(${ids}::uuid[])
    `
    const values = p.ready.flatMap((r) =>
      r.lines.map((l, position) => ({
        booking_id: r.row.id,
        position,
        service_id: l.serviceId,
        section: l.section,
        name: l.name,
        price: l.price,
        quantity: l.quantity,
      })),
    )
    // Пачками: у postgres-js предел 65535 параметров на запрос, а у строки их 7.
    let inserted = 0
    for (let i = 0; i < values.length; i += 1000) {
      inserted += (await tx`INSERT INTO booking_services ${tx(values.slice(i, i + 1000))}`).count
    }
    if (inserted !== values.length) {
      throw new Error(`вставлено ${inserted} строк вместо ${values.length}`)
    }
    for (const r of p.ready.filter((x) => x.discount > 0)) {
      const res = await tx`
        UPDATE bookings SET discount = ${r.discount} WHERE id = ${r.row.id} AND discount = 0
      `
      if (res.count !== 1) throw new Error(`скидка не записана: ${r.row.id}`)
    }

    // Сверка записанного с планом: у каждой записи столько строк и такой подытог,
    // сколько получилось при разборе, и скидка та же.
    const stored = await tx<{ id: string; lines: number; subtotal: number; discount: number }[]>`
      SELECT b.id, count(*)::int AS lines, sum(s.price * s.quantity)::int AS subtotal, b.discount
      FROM bookings b JOIN booking_services s ON s.booking_id = b.id
      WHERE b.id = ANY(${ids}::uuid[])
      GROUP BY b.id, b.discount
    `
    const byId = new Map(stored.map((r) => [r.id, r]))
    for (const r of p.ready) {
      const got = byId.get(r.row.id)
      const subtotal = r.lines.reduce((acc, l) => acc + l.price * l.quantity, 0)
      if (
        !got ||
        got.lines !== r.lines.length ||
        got.subtotal !== subtotal ||
        got.discount !== r.discount
      ) {
        throw new Error(`сверка не сошлась: ${r.row.id}`)
      }
    }
    return p.ready.length
  })

  if (applied === 0) {
    console.log('Нечего раскладывать — ничего не изменено.')
    return
  }
  console.log(`✓ Разложено записей: ${applied}. Затронутые id: таблица ${backupTable}`)
  // Откат обходит записи, которые после backfill меняли в приложении: их строки услуг
  // уже могли быть заменены пользователем, и удалять их нельзя.
  const untouched = `SELECT t.booking_id FROM ${backupTable} t WHERE NOT EXISTS (
      SELECT 1 FROM audit_log a WHERE a.entity = 'booking'
        AND a.entity_id = t.booking_id::text AND a.at > t.applied_at)`
  console.log('Откат (записи, измененные после backfill, остаются как есть):')
  console.log(`  BEGIN;
  UPDATE bookings b SET discount = t.discount FROM ${backupTable} t
    WHERE b.id = t.booking_id AND b.id IN (${untouched});
  DELETE FROM booking_services WHERE booking_id IN (${untouched});
  COMMIT;`)
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const verbose = args.has('--verbose')
  const sql = getSql()
  try {
    if (args.has('--apply')) {
      await apply(sql, verbose)
    } else {
      const [pricelist, rows] = await Promise.all([
        loadPricelist(sql),
        selectCandidates(sql, false),
      ])
      report(plan(rows, pricelist), rows.length, verbose)
      console.log('Dry-run: ничего не изменено. Для записи — --apply.')
    }
  } finally {
    await closeDb()
  }
}

// Запускается только при прямом вызове (не при импорте из теста).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
