import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { closeDb, getDb } from '../src/db/client.js'
import { sections, services } from '../src/db/schema.js'

interface SeedService {
  name: string
  description: string | null
  priceClass1: number
  priceClass2: number
  priceClass3: number
  priceClass4: number
}

interface SeedSection {
  name: string
  services: SeedService[]
}

interface SeedFile {
  generated_at: string
  source: string
  sections: SeedSection[]
}

const IN_PATH = resolve(import.meta.dirname, '../.seed/pricelist.json')

async function main(): Promise<void> {
  const raw = await readFile(IN_PATH, 'utf-8')
  const seed = JSON.parse(raw) as SeedFile

  const db = getDb()

  // Full replace — pricelist seed is authoritative.
  await db.delete(services)
  await db.delete(sections)

  let sectionCount = 0
  let serviceCount = 0

  for (const sec of seed.sections) {
    const [insertedSection] = await db
      .insert(sections)
      .values({ name: sec.name })
      .returning()
    if (!insertedSection) throw new Error(`failed to insert section "${sec.name}"`)
    sectionCount++

    if (sec.services.length === 0) continue

    const rows = sec.services.map((s) => ({
      sectionId: insertedSection.id,
      name: s.name,
      description: s.description,
      priceClass1: s.priceClass1,
      priceClass2: s.priceClass2,
      priceClass3: s.priceClass3,
      priceClass4: s.priceClass4,
    }))
    await db.insert(services).values(rows)
    serviceCount += rows.length
  }

  console.log(`✓ Loaded pricelist from ${IN_PATH}`)
  console.log(`  generated_at: ${seed.generated_at}`)
  console.log(`  source: ${seed.source}`)
  console.log(`  sections=${sectionCount}  services=${serviceCount}`)

  await closeDb()
}

await main()
