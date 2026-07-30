import type { Ref } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import { fetchClients } from './clients-api'
import { fetchPricelist } from './pricelist-api'
import { fetchMasters } from './masters-api'
import { fetchBookings, type GetApiBookingsParams } from './bookings-api'

// Query keys live next to the composables so callers never have to know the
// concrete string — they just call `useInvalidate*()` after a mutation.
export const CLIENTS_KEY = ['clients'] as const
export const PRICELIST_KEY = ['pricelist'] as const
export const MASTERS_KEY = ['masters'] as const
export const BOOKINGS_KEY = ['bookings'] as const

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

export function useMastersQuery() {
  return useQuery({
    key: MASTERS_KEY,
    query: fetchMasters,
  })
}

export function useInvalidateMasters() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: MASTERS_KEY })
}

// Reactive key so changing filters (dates, master, readiness, search, paging)
// refetches automatically. `params` is a ref the page recomputes from its
// filter state.
export function useBookingsQuery(params: Ref<GetApiBookingsParams>) {
  return useQuery({
    key: () => [...BOOKINGS_KEY, params.value],
    query: () => fetchBookings(params.value),
    // Keep the previous page/filter's rows on screen while the next request is
    // in flight, so fast refetches don't flash the loading skeleton.
    placeholderData: (previous) => previous,
  })
}

export function useInvalidateBookings() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: BOOKINGS_KEY })
}
