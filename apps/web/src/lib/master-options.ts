import type { Master } from '@detailing-admin/shared'

// Собирает варианты выпадающих списков мастера/ответственного в форме записи из актуальной
// таблицы `masters`. Возвращает пустой список, когда данных нет (загрузка / БД
// недоступна / таблица пуста); в этом случае форма показывает предупреждение, а
// не откатывается на захардкоженный список.
export function resolveMasterOptions(
  data: Master[] | undefined,
  filter: (m: Master) => boolean,
): string[] {
  if (!data) return []
  return data.filter(filter).map((m) => m.name)
}
