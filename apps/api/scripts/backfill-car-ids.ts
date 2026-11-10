/**
 * Заполняет id-связь booking↔car для строк, созданных до появления фичи (или
 * когда БД разошлась с Sheets). Не миграция данных — CLAUDE.md запрещает
 * править сгенерированный SQL вручную, — а обычный идемпотентный скрипт:
 *
 *   pnpm --filter @detailing-admin/api backfill:car-ids
 *
 * `bookings.car` — склеенная, почти не нормализованная строка; в `client_cars` лежат
 * нормализованные, раздельные марка/модель + номер — естественного ключа для равенства
 * нет. Сопоставляем, сводя ОБЕ стороны к ключу в нижнем регистре без пробелов:
 * восстанавливаем форму `joinCar` из раздельной строки машины, а затем одинаково
 * схлопываем регистр/пробелы с обеих сторон. Только в пределах одного `client_id` и
 * только для строк, где ещё `car_id IS NULL`, поэтому повторный запуск ничего не делает.
 * `DISTINCT ON (bb.id)` с самым ранним `created_at` детерминированно выбирает одну
 * машину, если несколько машин клиента схлопываются в один ключ. Несопоставленный
 * хвост (без клиента, похожие кириллические/латинские номера, лишние описания)
 * намеренно остаётся NULL — истиной остаётся снапшот-строка `car`.
 * Запускать ПОСЛЕ миграции.
 */
import { getSql, closeDb } from '../src/db/client.js'

type Sql = ReturnType<typeof getSql>

export async function backfillCarIds(sql: Sql): Promise<{
  linked: number
  remainingLinkable: number
}> {
  const linked = await sql`
    UPDATE bookings b
    SET car_id = m.car_id
    FROM (
      SELECT DISTINCT ON (bb.id) bb.id AS booking_id, cc.id AS car_id
      FROM bookings bb
      JOIN client_cars cc ON cc.client_id = bb.client_id
       AND lower(regexp_replace(bb.car, '\s+', '', 'g'))
         = lower(regexp_replace(
             cc.make_model || CASE WHEN cc.plate <> '' THEN ', ' || cc.plate ELSE '' END,
             '\s+', '', 'g'))
      WHERE bb.client_id IS NOT NULL AND btrim(bb.car) <> '' AND bb.car_id IS NULL
      ORDER BY bb.id, cc.created_at
    ) m
    WHERE b.id = m.booking_id AND b.car_id IS NULL
  `

  // Связываемые, но не связанные: есть клиент и непустой снапшот машины, но нет id
  // (нет строки client_cars с таким нормализованным ключом) — ожидаемый хвост.
  const [remaining] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM bookings b
    WHERE b.client_id IS NOT NULL AND btrim(b.car) <> '' AND b.car_id IS NULL
  `

  return { linked: linked.count, remainingLinkable: remaining?.count ?? 0 }
}

async function main(): Promise<void> {
  const sql = getSql()
  const res = await backfillCarIds(sql)

  console.log(`✓ car_id: ${res.linked} booking(s) linked`)
  console.log(`  linkable but still unlinked (no matching car): ${res.remainingLinkable}`)

  await closeDb()
}

// Запускается только при прямом вызове (не при импорте из теста).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
