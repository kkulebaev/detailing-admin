import { useQuery, useQueryCache } from '@pinia/colada'
import { fetchClients } from './clients-api'
import { fetchPricelist } from './pricelist-api'

// Query keys live next to the composables so callers never have to know the
// concrete string — they just call `useInvalidate*()` after a mutation.
export const CLIENTS_KEY = ['clients'] as const
export const PRICELIST_KEY = ['pricelist'] as const

export function useClientsQuery() {
  return useQuery({
    key: CLIENTS_KEY,
    query: fetchClients,
  })
}

export function usePricelistQuery() {
  return useQuery({
    key: PRICELIST_KEY,
    query: fetchPricelist,
  })
}

export function useInvalidateClients() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: CLIENTS_KEY })
}

export function useInvalidatePricelist() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: PRICELIST_KEY })
}
