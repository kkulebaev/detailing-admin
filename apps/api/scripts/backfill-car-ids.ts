/**
 * Backfills the booking↔car id-link for rows created before the feature (or
 * whenever the DB drifted from Sheets). Not a data-migration — CLAUDE.md forbids
 * hand-editing generated SQL — but a plain idempotent script:
 *
 *   pnpm --filter @detailing-admin/api backfill:car-ids
 *
 * `bookings.car` is a joined, largely-un-normalized string; `client_cars` holds
 * normalized, split make/model + plate — no natural-key equality exists. Match by
 * reducing BOTH sides to a whitespace-stripped lowercase key: reconstruct the
 * `joinCar` shape from the split car row, then collapse case/spacing the same way
 * on both. Only within the same `client_id`, only rows still `car_id IS NULL`, so
 * a re-run is a no-op. `DISTINCT ON (bb.id)` with the earliest `created_at`
 * deterministically picks one car when several of a client collapse to one key.
 * The unmatched tail (null-client, lookalike Cyrillic/Latin plates, extra
 * descriptors) stays NULL by design — the snapshot `car` string remains truth.
 * Run it AFTER the migration.
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

  // Linkable-but-unlinked: has a client and a non-empty car snapshot, yet no id
  // (no matching client_cars row under the normalized key) — the expected tail.
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

// Only run when executed directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
