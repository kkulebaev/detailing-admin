export const READINESS = [
  'Подтвердил',
  'Не ответил',
  'В работе',
  'Готова к выдаче',
  'Выдана',
  'Перенос',
  'Отмена',
  'Не приехал',
  'Оплачено',
  'Не оплачено',
] as const
export type Readiness = (typeof READINESS)[number]

// «Нет статуса» в списке фильтра (`?readiness=В работе,none`): в базе это пустая
// строка, а пустой элемент в списке через запятую неотличим от лишней запятой.
export const READINESS_FILTER_NONE = 'none'
