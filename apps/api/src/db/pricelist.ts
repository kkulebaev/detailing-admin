import { eq, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import {
  sections,
  services,
  type NewService,
  type Section,
  type Service,
} from './schema.js'

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

export type SectionMutationError = 'duplicate_name' | 'not_found' | 'has_services'

export class PricelistError extends Error {
  constructor(public readonly code: SectionMutationError) {
    super(code)
    this.name = 'PricelistError'
  }
}

async function findSectionByName(name: string): Promise<Section | undefined> {
  const db = getDb()
  const rows = await db.select().from(sections).where(eq(sections.name, name)).limit(1)
  return rows[0]
}

export async function createSection(name: string): Promise<Section> {
  const db = getDb()
  const existing = await findSectionByName(name)
  if (existing) throw new PricelistError('duplicate_name')
  const [row] = await db.insert(sections).values({ name }).returning()
  return row
}

export async function updateSection(id: number, name: string): Promise<Section> {
  const db = getDb()
  const duplicate = await findSectionByName(name)
  if (duplicate && duplicate.id !== id) throw new PricelistError('duplicate_name')
  const [row] = await db
    .update(sections)
    .set({ name })
    .where(eq(sections.id, id))
    .returning()
  if (!row) throw new PricelistError('not_found')
  return row
}

export async function deleteSection(id: number): Promise<void> {
  const db = getDb()
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(services)
    .where(eq(services.sectionId, id))
  if (count > 0) throw new PricelistError('has_services')
  const result = await db.delete(sections).where(eq(sections.id, id)).returning({ id: sections.id })
  if (result.length === 0) throw new PricelistError('not_found')
}

async function ensureSectionExists(id: number): Promise<void> {
  const db = getDb()
  const rows = await db.select({ id: sections.id }).from(sections).where(eq(sections.id, id)).limit(1)
  if (rows.length === 0) throw new PricelistError('not_found')
}

export async function createService(input: NewService): Promise<Service> {
  const db = getDb()
  await ensureSectionExists(input.sectionId)
  const [row] = await db.insert(services).values(input).returning()
  return row
}

export type ServiceUpdate = Partial<Omit<NewService, 'id'>>

export async function updateService(id: number, input: ServiceUpdate): Promise<Service> {
  const db = getDb()
  if (input.sectionId !== undefined) {
    await ensureSectionExists(input.sectionId)
  }
  const [row] = await db.update(services).set(input).where(eq(services.id, id)).returning()
  if (!row) throw new PricelistError('not_found')
  return row
}

export async function deleteService(id: number): Promise<void> {
  const db = getDb()
  const result = await db.delete(services).where(eq(services.id, id)).returning({ id: services.id })
  if (result.length === 0) throw new PricelistError('not_found')
}
