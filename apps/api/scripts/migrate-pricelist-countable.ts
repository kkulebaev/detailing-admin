import { and, eq, ilike, or } from 'drizzle-orm'
import { closeDb, getDb } from '../src/db/client.js'
import { services } from '../src/db/schema.js'

// One-off data migration: flag «штучные» services as countable based on their
// name. Matches any mention of «шт» (covers «1 шт.», «(2 шт.)», «4 шт.» …) and
// the bracketed «(… зон…)» form (e.g. «Ковролин (1 зона)»). The paren in the
// зон-pattern is what keeps «Озонация салона» and «Оклейка зон риска» out.
//
// Idempotent: only rows still at countable=false are touched, so re-running is
// a no-op. Run against any DATABASE_URL (local now, prod on deploy):
//   pnpm --filter @detailing-admin/api migrate:countable
async function main(): Promise<void> {
  const db = getDb()

  const updated = await db
    .update(services)
    .set({ countable: true })
    .where(
      and(
        eq(services.countable, false),
        or(ilike(services.name, '%шт%'), ilike(services.name, '%(%зон%')),
      ),
    )
    .returning({ id: services.id, name: services.name })

  if (updated.length === 0) {
    console.log('✓ Nothing to migrate — no unflagged «штучные» services found')
  } else {
    console.log(`✓ Marked ${updated.length} service(s) as countable:`)
    for (const s of updated) console.log(`  [${s.id}] ${s.name}`)
  }

  await closeDb()
}

await main()
