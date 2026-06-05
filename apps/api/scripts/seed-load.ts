import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { upsertClient } from '../src/db/clients.js'
import { closeDb } from '../src/db/client.js'

interface SeedFile {
  generated_at: string
  spreadsheet_id: string
  totals: { unique_clients: number }
  entries: { phone: string; name: string }[]
}

const IN_PATH = resolve(import.meta.dirname, '../.seed/clients.json')

async function main(): Promise<void> {
  const raw = await readFile(IN_PATH, 'utf-8')
  const seed = JSON.parse(raw) as SeedFile

  const counts = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 }

  for (const entry of seed.entries) {
    const { outcome } = await upsertClient(entry.phone, entry.name)
    counts[outcome]++
  }

  console.log(`✓ Loaded ${seed.entries.length} entries from ${IN_PATH}`)
  console.log(`  seed generated_at: ${seed.generated_at}`)
  console.log(
    `  inserted=${counts.inserted}  updated=${counts.updated}  unchanged=${counts.unchanged}  skipped=${counts.skipped}`,
  )

  await closeDb()
}

await main()
