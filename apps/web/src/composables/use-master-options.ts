import { computed } from 'vue'
import { useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'

// Списки мастера/ответственного строятся по живой таблице `masters`, но никогда не
// должны делать оформление записи зависимым от Postgres — `resolveMasterOptions`
// откатывается к зашитому enum, когда списка нет или он пуст.
export function useMasterOptions() {
  const { data, asyncStatus } = useMastersQuery()
  const live = computed(() => (data.value?.ok ? data.value.masters : undefined))
  const forMaster = computed(() => resolveMasterOptions(live.value, () => true))
  const forResponsible = computed(() => resolveMasterOptions(live.value, (m) => m.canBeResponsible))
  const loading = computed(() => asyncStatus.value === 'loading' && data.value === undefined)
  // Без запасного enum незагруженный или пустой список оставляет селект мастера
  // пустым — предупреждаем явно, чтобы форма не выглядела молча сломанной.
  const warning = computed(() => {
    if (loading.value || forMaster.value.length > 0) return null
    return data.value?.ok
      ? 'Список мастеров пуст. Добавьте мастеров на странице «Мастера».'
      : 'Список мастеров недоступен. Обновите страницу.'
  })
  return { forMaster, forResponsible, loading, warning }
}
