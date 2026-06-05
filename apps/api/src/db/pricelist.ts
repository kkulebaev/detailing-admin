import { getDb } from './client.js'
import { sections, services, type Service } from './schema.js'

export interface PricelistSection {
  id: number
  name: string
  services: Service[]
}

export async function listPricelist(): Promise<PricelistSection[]> {
  const db = getDb()
  const [allSections, allServices] = await Promise.all([
    db.select().from(sections).orderBy(sections.id),
    db.select().from(services).orderBy(services.id),
  ])

  const byId = new Map<number, PricelistSection>()
  for (const s of allSections) {
    byId.set(s.id, { id: s.id, name: s.name, services: [] })
  }
  for (const svc of allServices) {
    byId.get(svc.sectionId)?.services.push(svc)
  }
  return [...byId.values()]
}
