/**
 * Заполняет id-связь booking↔master для строк, созданных до появления фичи (или
 * когда БД разошлась с Sheets). Не миграция данных — CLAUDE.md запрещает
 * править сгенерированный SQL вручную, — а обычный идемпотентный скрипт:
 *
 *   pnpm --filter @detailing-admin/api backfill:master-ids
 *
 * Оба запроса безопасно запускать повторно: вставка в связующую таблицу — `ON CONFLICT
 * DO NOTHING` (составной PK), а `responsible_id` проставляется только там, где ещё NULL,
 * так что переименование после первого запуска не затирается. Сопоставление — по точному
 * `name` (та же семантика, что и на пути записи). Запускать ПОСЛЕ миграции.
 */
import { getSql, closeDb } from '../src/db/client.js'

type Sql = ReturnType<typeof getSql>

export async function backfillMasterIds(sql: Sql): Promise<{
  arraysNormalized: number
  linksInserted: number
  responsibleLinked: number
  unmatchedMasters: string[]
  unmatchedResponsible: string[]
}> {
  // Строки до появления нескольких мастеров хранили нескольких мастеров одним элементом,
  // склеенным через `', '` (`['A, B']`), — наследие тех времён, когда `master` был одной
  // строкой, обёрнутой как есть при переходе столбца на `text[]`. Делим каждый элемент по
  // `', '`, чтобы в массиве было по одному имени на слот, как на текущем пути записи.
  // Затрагиваются только реально меняющиеся строки (`IS DISTINCT FROM`), поэтому повторный
  // запуск ничего не делает: имя без `', '` делится само в себя. В именах из списка мастеров
  // нет запятых, так что деление не ломает настоящее одиночное имя. Столбец J в Sheets не
  // трогается — меняется только форма массива в зеркале БД на «одно имя на слот», чтобы
  // `position` в связующей таблице и обогащение при чтении совпадали по каждому мастеру.
  const normalized = await sql`
    UPDATE bookings b
    SET master = sub.arr
    FROM (
      SELECT b2.id,
             array_agg(btrim(part) ORDER BY elem_ord, part_ord) AS arr
      FROM bookings b2
      CROSS JOIN LATERAL unnest(b2.master) WITH ORDINALITY AS e(elem, elem_ord)
      CROSS JOIN LATERAL unnest(string_to_array(e.elem, ', ')) WITH ORDINALITY AS p(part, part_ord)
      WHERE btrim(part) <> ''
      GROUP BY b2.id
    ) sub
    WHERE b.id = sub.id AND b.master IS DISTINCT FROM sub.arr
  `

  // `position` привязывает каждую связь к её слоту в снапшоте (индекс в `master[]`), чтобы
  // обогащение при чтении могло наложить актуальное имя на нужный слот. WITH ORDINALITY
  // даёт слот с отсчётом от 1; DISTINCT ON оставляет первое вхождение повторяющегося
  // мастера, как и правило «побеждает первый индекс» на пути записи.
  const junction = await sql`
    INSERT INTO booking_masters (booking_id, master_id, position)
    SELECT DISTINCT ON (b.id, m.id) b.id, m.id, (u.ord - 1)::smallint
    FROM bookings b
    CROSS JOIN LATERAL unnest(b.master) WITH ORDINALITY AS u(name, ord)
    JOIN masters m ON m.name = u.name
    ORDER BY b.id, m.id, u.ord
    ON CONFLICT (booking_id, master_id) DO NOTHING
  `

  const responsible = await sql`
    UPDATE bookings b
    SET responsible_id = m.id
    FROM masters m
    WHERE m.name = b.responsible AND b.responsible_id IS NULL
  `

  const unmatchedMasters = await sql<{ name: string }[]>`
    SELECT DISTINCT u.name
    FROM bookings b
    CROSS JOIN LATERAL unnest(b.master) AS u(name)
    LEFT JOIN masters m ON m.name = u.name
    WHERE m.id IS NULL
    ORDER BY u.name
  `

  const unmatchedResponsible = await sql<{ name: string }[]>`
    SELECT DISTINCT b.responsible AS name
    FROM bookings b
    LEFT JOIN masters m ON m.name = b.responsible
    WHERE b.responsible <> '' AND m.id IS NULL
    ORDER BY b.responsible
  `

  return {
    arraysNormalized: normalized.count,
    linksInserted: junction.count,
    responsibleLinked: responsible.count,
    unmatchedMasters: unmatchedMasters.map((r) => r.name),
    unmatchedResponsible: unmatchedResponsible.map((r) => r.name),
  }
}

async function main(): Promise<void> {
  const sql = getSql()
  const res = await backfillMasterIds(sql)

  console.log(`✓ master arrays normalized: ${res.arraysNormalized} row(s) split`)
  console.log(`✓ booking_masters: ${res.linksInserted} link(s) inserted`)
  console.log(`✓ responsible_id: ${res.responsibleLinked} booking(s) linked`)
  console.log(
    `  unmatched master names (${res.unmatchedMasters.length}): ${res.unmatchedMasters.join(', ') || '—'}`,
  )
  console.log(
    `  unmatched responsible names (${res.unmatchedResponsible.length}): ${
      res.unmatchedResponsible.join(', ') || '—'
    }`,
  )

  await closeDb()
}

// Запускается только при прямом вызове (не при импорте из теста).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
