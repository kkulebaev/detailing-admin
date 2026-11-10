import type { BookingRow, Readiness } from '@detailing-admin/shared'

// Единый источник цветов статусов готовности, две цели отрисовки: бейдж-«таблетка»
// (история в карточке клиента) и заливка всей строки (таблица записей). Обе завязаны на
// один и тот же union `Readiness` — опечатка в статусе дает ошибку компиляции, а смена цвета
// статуса затрагивает один файл вместо того, чтобы расходиться между страницами. Обе карты
// покрывают все статусы; только '' («нет статуса») уходит в fallback.
//
// Цвета намеренно совпадают там, где статусы с первого взгляда значат одно и то же:
// зеленый — все в порядке («Подтвердил», «Оплачено»), оранжевый — еще не закрыто
// («В работе», «Не оплачено»), красный — запись сорвалась или под вопросом
// («Не приехал», «Отмена», «Не ответил»). Не «исправляйте» повторы на
// разные оттенки.

// Бейдж-«таблетка» (пары bg-100 / text-800; «Выдана» приглушена как завершенная работа).
const READINESS_BADGE_CLASS: Record<Readiness, string> = {
  'В работе': 'bg-orange-100 text-orange-800',
  'Готова к выдаче': 'bg-sky-100 text-sky-800',
  Перенос: 'bg-violet-100 text-violet-800',
  Выдана: 'bg-zinc-100 text-zinc-600',
  'Не ответил': 'bg-red-200 text-red-900',
  Подтвердил: 'bg-green-100 text-green-800',
  'Не приехал': 'bg-red-200 text-red-900',
  Отмена: 'bg-red-200 text-red-900',
  Оплачено: 'bg-green-100 text-green-800',
  'Не оплачено': 'bg-orange-100 text-orange-800',
}

export function readinessBadgeClass(readiness: BookingRow['readiness']): string {
  if (!readiness) return 'bg-muted text-muted-foreground'
  return READINESS_BADGE_CLASS[readiness] ?? 'bg-muted text-muted-foreground'
}

// Заливка всей строки для таблицы записей. `!` перебивает hover строки;
// «Выдана» приглушена (почти белый + серый текст), чтобы взгляд цеплялся за активные статусы,
// а не за завершенные. Только пустой статус вместо этого получает сброс hover.
const READINESS_ROW_CLASS: Record<Readiness, string> = {
  'В работе': 'bg-orange-100!',
  'Готова к выдаче': 'bg-sky-100!',
  Перенос: 'bg-violet-100!',
  Выдана: 'bg-zinc-50! text-muted-foreground',
  'Не ответил': 'bg-red-200!',
  Подтвердил: 'bg-green-100!',
  'Не приехал': 'bg-red-200!',
  Отмена: 'bg-red-200!',
  Оплачено: 'bg-green-100!',
  'Не оплачено': 'bg-orange-100!',
}

export function readinessRowClass(readiness: BookingRow['readiness']): string {
  if (!readiness) return 'hover:bg-transparent'
  return READINESS_ROW_CLASS[readiness] ?? 'hover:bg-transparent'
}
