import type { Ref } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import { fetchAnalyticsOverview, type GetApiAnalyticsOverviewParams } from './analytics-api'
import {
  fetchClientDetail,
  fetchClients,
  lookupClientByPhone,
  type ClientLookupMatch,
  type GetApiClientsParams,
} from './clients-api'
import { fetchPricelist } from './pricelist-api'
import { fetchAccounts, fetchMasters } from './masters-api'
import { fetchMySalary } from './me-api'
import {
  fetchBookingHistory,
  fetchBookings,
  fetchDeletedBookings,
  type GetApiBookingsParams,
} from './bookings-api'
import { fetchSalaries, fetchSalaryEntries } from './salaries-api'

// Ключи запросов лежат рядом с composables, чтобы вызывающему коду не нужно было знать
// конкретную строку — после мутации он просто вызывает `useInvalidate*()`.
export const CLIENTS_KEY = ['clients'] as const
export const PRICELIST_KEY = ['pricelist'] as const
export const MASTERS_KEY = ['masters'] as const
export const BOOKINGS_KEY = ['bookings'] as const
export const SALARIES_KEY = ['salaries'] as const
export const SALARY_ENTRIES_KEY = ['salary-entries'] as const
export const ANALYTICS_KEY = ['analytics'] as const
export const ACCOUNTS_KEY = ['accounts'] as const
export const MY_SALARY_KEY = ['my-salary'] as const

// Реактивный ключ, чтобы смена поискового запроса, сортировки или пагинации
// автоматически вызывала перезапрос. `params` — ref, который страница пересчитывает из
// состояния фильтров; placeholderData держит на экране строки предыдущей страницы, пока
// следующий запрос в полете (без мигания загрузки).
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

// Детали карточки клиента. `id` равен null, пока клиент не выбран (Sheet
// закрыт), — guard `enabled` держит запрос в простое, пока в маршруте не появится
// id. Сегмент ключа `'detail'` оставляет место, чтобы позже вынести историю записей в
// отдельный запрос с пагинацией (доработка), не переставляя этот ключ.
export function useClientDetailQuery(id: Ref<string | null>) {
  return useQuery({
    key: () => [...CLIENTS_KEY, 'detail', id.value ?? ''],
    // enabled включает запрос только при id != null, так что fallback ?? '' никогда не срабатывает.
    query: () => fetchClientDetail(id.value ?? ''),
    enabled: () => id.value != null,
  })
}

// Автозаполнение в форме записи: находит клиента по полному E.164-
// телефону. `e164` — computed на стороне формы (null, пока введенный телефон
// неполный); guard `enabled` держит запрос в простое, пока номер не станет
// полным, а colada дедуплицирует/кэширует по ключу телефона, так что повторные совпадения
// бесплатны.
export function useClientLookupByPhoneQuery(e164: Ref<string | null>) {
  return useQuery<ClientLookupMatch | null>({
    key: () => [...CLIENTS_KEY, 'lookup', e164.value ?? ''],
    // enabled включает запрос только при e164 != null, так что утверждение ! никогда
    // не применяется к null.
    query: () => lookupClientByPhone(e164.value!),
    enabled: () => !!e164.value,
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

// `enabled` не дает запросу, доступному только админу, уйти, пока не откроется диалог
// мастера; самой странице мастеров аккаунты не нужны.
export function useAccountsQuery(enabled: Ref<boolean>) {
  return useQuery({
    key: ACCOUNTS_KEY,
    query: fetchAccounts,
    enabled: () => enabled.value,
  })
}

// «Мои часы»: собственный месяц вошедшего аккаунта. placeholderData держит
// предыдущий месяц на экране, пока грузится следующий, как на странице зарплат.
export function useMySalaryQuery(month: Ref<string>) {
  return useQuery({
    key: () => [...MY_SALARY_KEY, month.value],
    query: () => fetchMySalary(month.value),
    placeholderData: (previous) => previous,
  })
}

export function useInvalidateMySalary() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: MY_SALARY_KEY })
}

// Реактивный ключ, чтобы смена фильтров (даты, мастер, готовность, поиск, пагинация)
// автоматически вызывала перезапрос. `params` — ref, который страница пересчитывает из
// состояния фильтров.
export function useBookingsQuery(params: Ref<GetApiBookingsParams>) {
  return useQuery({
    key: () => [...BOOKINGS_KEY, params.value],
    query: () => fetchBookings(params.value),
    // Держим на экране строки предыдущей страницы/фильтра, пока следующий запрос
    // в полете, чтобы быстрые перезапросы не мигали скелетоном загрузки.
    placeholderData: (previous) => previous,
  })
}

// Оба ключа лежат под BOOKINGS_KEY: любая правка, удаление или восстановление
// через useInvalidateBookings() освежает и историю, и корзину.
export function useBookingHistoryQuery(id: Ref<string | null>) {
  return useQuery({
    key: () => [...BOOKINGS_KEY, 'history', id.value ?? ''],
    query: () => fetchBookingHistory(id.value ?? ''),
    enabled: () => id.value != null,
  })
}

export function useDeletedBookingsQuery(enabled: Ref<boolean>) {
  return useQuery({
    key: [...BOOKINGS_KEY, 'deleted'],
    query: fetchDeletedBookings,
    enabled: () => enabled.value,
  })
}

export function useInvalidateBookings() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: BOOKINGS_KEY })
}

// Реактивный ключ, чтобы переключение месяца автоматически вызывало перезапрос. `month` —
// выбранный на странице `YYYY-MM`; placeholderData держит строки предыдущего месяца на
// экране, пока следующий запрос в полете (без мигания загрузки).
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

// Детали мастера за месяц: часы и выплаты одной слитой лентой. `masterId` равен
// null, пока мастер не выбран, — guard `enabled` держит запрос в простое,
// пока он не появится.
export function useSalaryEntriesQuery(masterId: Ref<number | null>, month: Ref<string>) {
  return useQuery({
    key: () => [...SALARY_ENTRIES_KEY, masterId.value ?? 0, month.value],
    // enabled включает запрос только при masterId != null, так что fallback ?? 0
    // никогда не срабатывает.
    query: () => fetchSalaryEntries(masterId.value ?? 0, month.value),
    enabled: () => masterId.value != null,
  })
}

export function useInvalidateSalaryEntries() {
  const cache = useQueryCache()
  return () => cache.invalidateQueries({ key: SALARY_ENTRIES_KEY })
}

// Реактивный ключ, чтобы смена периода или гранулярности автоматически вызывала перезапрос.
// `params` — ref, который страница пересчитывает из состояния фильтров; placeholderData
// держит на экране цифры предыдущего периода, пока следующий запрос в
// полете (без мигания загрузки при каждой смене периода/гранулярности).
export function useAnalyticsOverviewQuery(params: Ref<GetApiAnalyticsOverviewParams>) {
  return useQuery({
    key: () => [...ANALYTICS_KEY, params.value],
    query: () => fetchAnalyticsOverview(params.value),
    placeholderData: (previous) => previous,
  })
}
