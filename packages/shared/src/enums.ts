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
