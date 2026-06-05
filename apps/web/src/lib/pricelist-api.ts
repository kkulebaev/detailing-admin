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
