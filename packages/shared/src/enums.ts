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

// Single list of people — used for both Мастер and Ответственный fields.
export const MASTERS = [
  'Вячеслав Толстов',
  'Иван Содель',
  'Сергей Теплов',
  'Дмитрий Глотов',
  'Андрей и ко.',
] as const
export type MasterName = (typeof MASTERS)[number]
