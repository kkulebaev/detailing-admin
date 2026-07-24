import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { closeDb, getDb } from '../src/db/client.js'
import { sections, services } from '../src/db/schema.js'

// Legacy seed files carry a single price per class (priceClassN); current ones
// carry min/max pairs (priceClassNMin/priceClassNMax). Legacy values load as
// fixed prices (max = null).
interface SeedService {
  name: string
  description: string | null
  priceClass1?: number
  priceClass2?: number
  priceClass3?: number
  priceClass4?: number
  priceClass1Min?: number
  priceClass1Max?: number | null
  priceClass2Min?: number
  priceClass2Max?: number | null
  priceClass3Min?: number
  priceClass3Max?: number | null
  priceClass4Min?: number
  priceClass4Max?: number | null
}

interface ServicePrices {
  priceClass1Min: number
  priceClass1Max: number | null
  priceClass2Min: number
  priceClass2Max: number | null
  priceClass3Min: number
  priceClass3Max: number | null
  priceClass4Min: number
  priceClass4Max: number | null
}

function toPrices(s: SeedService): ServicePrices {
  function one(min: number | undefined, max: number | null | undefined, legacy: number | undefined) {
    const resolvedMin = min ?? legacy
    if (typeof resolvedMin !== 'number') {
      throw new Error(`service "${s.name}" is missing a price field`)
    }
    const resolvedMax = typeof max === 'number' && max !== resolvedMin ? max : null
    return { min: resolvedMin, max: resolvedMax }
  }
  const c1 = one(s.priceClass1Min, s.priceClass1Max, s.priceClass1)
  const c2 = one(s.priceClass2Min, s.priceClass2Max, s.priceClass2)
  const c3 = one(s.priceClass3Min, s.priceClass3Max, s.priceClass3)
  const c4 = one(s.priceClass4Min, s.priceClass4Max, s.priceClass4)
  return {
    priceClass1Min: c1.min,
    priceClass1Max: c1.max,
    priceClass2Min: c2.min,
    priceClass2Max: c2.max,
    priceClass3Min: c3.min,
    priceClass3Max: c3.max,
    priceClass4Min: c4.min,
    priceClass4Max: c4.max,
  }
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
      ...toPrices(s),
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
