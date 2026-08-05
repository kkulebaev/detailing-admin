/**
 * Backfills the booking↔master id-link for rows created before the feature (or
 * whenever the DB drifted from Sheets). Not a data-migration — CLAUDE.md forbids
 * hand-editing generated SQL — but a plain idempotent script:
 *
 *   pnpm --filter @detailing-admin/api backfill:master-ids
 *
 * Both statements are safe to re-run: the junction insert is `ON CONFLICT DO
 * NOTHING` (composite PK), and `responsible_id` is only set where still NULL, so
 * a rename after a first run is never clobbered. Matching is by exact `name`
 * (same semantics as the write path). Run it AFTER the migration.
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
  // Pre-multi-master rows stored several masters as a single `', '`-joined element
  // (`['A, B']`) — a leftover from when `master` was one string, wrapped verbatim
  // when the column became `text[]`. Split each element on `', '` so the array
  // holds one name per slot, matching the current write path's shape. Only rows
  // that actually change are touched (`IS DISTINCT FROM`), so a re-run is a no-op:
  // a name with no `', '` splits to itself. Roster names carry no comma, so the
  // split never breaks a legitimate single name. Sheets column J is untouched —
  // this only reshapes the DB mirror's array to the one-name-per-slot model so the
  // junction `position` and the read enrichment line up per master.
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

  // `position` anchors each link to its snapshot slot (index in `master[]`) so the
  // read enrichment can overlay a live name onto the right slot. WITH ORDINALITY
  // yields the 1-based slot; DISTINCT ON keeps the first occurrence of a repeated
  // master, matching the write path's "first index wins".
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

// Only run when executed directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
