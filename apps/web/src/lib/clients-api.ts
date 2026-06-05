const PROD_API_FALLBACK = 'https://detailing-admin-api.up.railway.app'
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
const apiBase = envBase || (import.meta.env.DEV ? '' : PROD_API_FALLBACK)

export interface Client {
  id: string
  phone: string
  name: string
}

export type ClientsApiResult =
  | { ok: true; clients: Client[] }
  | { ok: false; error: 'unavailable'; reason: 'not_configured'; message: string }
  | { ok: false; error: 'internal' }

export async function fetchClients(): Promise<ClientsApiResult> {
  const res = await fetch(`${apiBase}/api/clients`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { ok: false, error: 'internal' }
  }

  return res.json() as Promise<ClientsApiResult>
}
