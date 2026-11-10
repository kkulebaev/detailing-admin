import { computed, type Ref } from 'vue'
import { normalizePhone } from '@detailing-admin/shared'
import { useClientLookupByPhoneQuery } from '@/lib/queries'
import type { Client } from '@/lib/clients-api'
import type { ClientLookupSummary } from '@detailing-admin/shared'

// Хелпер автозаполнения для формы записи: превращает сырой ввод телефона в
// точное совпадение с клиентом. `e164` равен null, пока введённый номер не нормализуется в
// полный +7XXXXXXXXXX, — это гейт для нижележащего запроса, так что частичный/мусорный ввод
// никогда не шлёт запрос. Дедуп/кэш/устаревание берёт на себя colada; сброс на пустой
// телефон переводит `e164` в null (enabled=false), поэтому запоздалый ответ по устаревшему ключу
// никогда не применяется.
export function useClientLookup(phoneRaw: Ref<string>) {
  const e164 = computed<string | null>(() => {
    try {
      const n = normalizePhone(phoneRaw.value)
      return /^\+7\d{10}$/.test(n) ? n : null
    } catch {
      return null
    }
  })

  const { data, asyncStatus } = useClientLookupByPhoneQuery(e164)

  const matchedClient = computed<Client | null>(() => data.value?.client ?? null)
  const matchedClientSummary = computed<ClientLookupSummary | null>(
    () => data.value?.summary ?? null,
  )

  // «Загрузка» только пока реальный поиск в полёте (номер введён полностью) — при null
  // в e164 запрос отключён, так что для частичного ввода здесь остаётся false.
  const isLoading = computed(() => !!e164.value && asyncStatus.value === 'loading')

  return { matchedClient, matchedClientSummary, isLoading }
}
