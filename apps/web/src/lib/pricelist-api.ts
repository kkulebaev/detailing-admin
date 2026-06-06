const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
const apiBase = envBase || (import.meta.env.DEV ? '' : PROD_API_FALLBACK)

export interface PricelistService {
  id: number
  sectionId: number
  name: string
  description: string | null
  priceClass1: number | null
  priceClass2: number | null
  priceClass3: number | null
  priceClass4: number | null
}

export interface PricelistSection {
  id: number
  name: string
  services: PricelistService[]
}

export type PricelistApiResult =
  | { ok: true; sections: PricelistSection[] }
  | { ok: false; error: 'unavailable'; reason: 'not_configured'; message: string }
  | { ok: false; error: 'internal' }

export interface SectionInputPayload {
  name: string
}

export interface ServiceInputPayload {
  sectionId: number
  name: string
  description: string | null
  priceClass1: number | null
  priceClass2: number | null
  priceClass3: number | null
  priceClass4: number | null
}

type ValidationIssue = { path: (string | number)[]; message: string }

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'validation'; issues: ValidationIssue[] }
  | { ok: false; error: 'conflict'; reason: 'duplicate_name' | 'has_services' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unavailable'; message: string }
  | { ok: false; error: 'internal' }

export interface PricelistSectionRow {
  id: number
  name: string
}

async function jsonOrInternal(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return null
  }
  return res.json()
}

export async function fetchPricelist(): Promise<PricelistApiResult> {
  const res = await fetch(`${apiBase}/api/pricelist`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { ok: false, error: 'internal' }
  }

  return res.json() as Promise<PricelistApiResult>
}

async function mutate<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  extract: (raw: any) => T,
): Promise<MutationResult<T>> {
  let res: Response
  try {
    res = await fetch(`${apiBase}${url}`, {
      method,
      headers: body !== undefined
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    return { ok: false, error: 'internal' }
  }

  const raw = (await jsonOrInternal(res)) as any
  if (!raw) return { ok: false, error: 'internal' }

  if (raw.ok === true) {
    return { ok: true, data: extract(raw) }
  }
  if (raw.error === 'validation') {
    return { ok: false, error: 'validation', issues: raw.issues ?? [] }
  }
  if (raw.error === 'conflict') {
    return { ok: false, error: 'conflict', reason: raw.reason }
  }
  if (raw.error === 'not_found') {
    return { ok: false, error: 'not_found' }
  }
  if (raw.error === 'unavailable') {
    return { ok: false, error: 'unavailable', message: raw.message ?? 'База данных недоступна' }
  }
  return { ok: false, error: 'internal' }
}

export function createSection(payload: SectionInputPayload) {
  return mutate('/api/pricelist/sections', 'POST', payload, (r) => r.section as PricelistSectionRow)
}

export function updateSection(id: number, payload: SectionInputPayload) {
  return mutate(`/api/pricelist/sections/${id}`, 'PATCH', payload, (r) => r.section as PricelistSectionRow)
}

export function deleteSection(id: number) {
  return mutate(`/api/pricelist/sections/${id}`, 'DELETE', undefined, () => undefined as void)
}

export function createService(payload: ServiceInputPayload) {
  return mutate('/api/pricelist/services', 'POST', payload, (r) => r.service as PricelistService)
}

export function updateService(id: number, payload: ServiceInputPayload) {
  return mutate(`/api/pricelist/services/${id}`, 'PATCH', payload, (r) => r.service as PricelistService)
}

export function deleteService(id: number) {
  return mutate(`/api/pricelist/services/${id}`, 'DELETE', undefined, () => undefined as void)
}
