import type { Ref } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import { fetchAnalyticsOverview, type GetApiAnalyticsOverviewParams } from './analytics-api'
import { fetchClients, type GetApiClientsParams } from './clients-api'
import { fetchPricelist } from './pricelist-api'
import { fetchMasters } from './masters-api'
import { fetchBookings, type GetApiBookingsParams } from './bookings-api'
import { fetchSalaries, fetchWorkHours } from './salaries-api'

// Query keys live next to the composables so callers never have to know the
// concrete string — they just call `useInvalidate*()` after a mutation.
export const CLIENTS_KEY = ['clients'] as const
export const PRICELIST_KEY = ['pricelist'] as const
export const MASTERS_KEY = ['masters'] as const
export const BOOKINGS_KEY = ['bookings'] as const
export const SALARIES_KEY = ['salaries'] as const
export const WORK_HOURS_KEY = ['work-hours'] as const
export const ANALYTICS_KEY = ['analytics'] as const

// Reactive key so changing the search term, sort, or paging refetches
// automatically. `params` is a ref the page recomputes from its filter state;
// placeholderData keeps the previous page's rows on screen while the next
// request is in flight (no loading flash).
export function useClientsQuery(params: Ref<GetApiClientsParams>) {
  return useQuery({
    key: () => [...CLIENTS_KEY, params.value],
    query: () => fetchClients(params.value),
    placeholderData: (previous) => previous,
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

// Reactive key so switching months refetches automatically. `month` is the
// page's selected `YYYY-MM`; placeholderData keeps the previous month's rows on
// screen while the next request is in flight (no loading flash).
export function useSalariesQuery(month: Ref<string>) {
  return useQuery({
    key: () => [...SALARIES_KEY, month.value],
    query: () => fetchSalaries(month.value),
    placeholderData: (previous) => previous,
  })
}

export function useInvalidateSalaries() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: SALARIES_KEY })
}

// Per-master month detail. `masterId` is null while no master is selected — the
// `enabled` guard keeps the query idle until one is.
export function useWorkHoursQuery(masterId: Ref<number | null>, month: Ref<string>) {
  return useQuery({
    key: () => [...WORK_HOURS_KEY, masterId.value ?? 0, month.value],
    // enabled gates this on masterId != null, so the ?? 0 fallback never runs.
    query: () => fetchWorkHours(masterId.value ?? 0, month.value),
    enabled: () => masterId.value != null,
  })
}

export function useInvalidateWorkHours() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: WORK_HOURS_KEY })
}

// Reactive key so changing the period or granularity refetches automatically.
// `params` is a ref the page recomputes from its filter state; placeholderData
// keeps the previous period's numbers on screen while the next request is in
// flight (no loading flash on every period/granularity change).
export function useAnalyticsOverviewQuery(params: Ref<GetApiAnalyticsOverviewParams>) {
  return useQuery({
    key: () => [...ANALYTICS_KEY, params.value],
    query: () => fetchAnalyticsOverview(params.value),
    placeholderData: (previous) => previous,
  })
}
