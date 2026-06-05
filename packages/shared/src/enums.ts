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

export const MASTERS = [
  'Вячеслав Толстов',
  'Иван Содель',
  '-',
  'Сергей Теплов',
  'Дмитрий Глотов',
  'Андрей и ко.',
] as const
export type Master = (typeof MASTERS)[number]

export const RESPONSIBLES = [
  'Вячеслав Толстов',
  'Иван Содель',
  '-',
  'Сергей Теплов',
  'Дмитрий Глотов',
  'Андрей и ко.',
  'Отмена',
] as const
export type Responsible = (typeof RESPONSIBLES)[number]
