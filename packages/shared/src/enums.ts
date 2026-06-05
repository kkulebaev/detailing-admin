export const READINESS = ['Выдана', 'Отмена'] as const
export type Readiness = (typeof READINESS)[number]

// MVP: free-text. When MASTERS is non-empty, swap booking.master back to z.enum(MASTERS).or(z.literal('')).default('').
export const MASTERS = [] as const
export type Master = (typeof MASTERS)[number]

export const RESPONSIBLES = [
  'Вячеслав Толстов',
  'Сергей Теплов',
  'Дмитрий Глотов',
  'Иван Содель',
  'Андрей и ко.',
  'Отмена',
] as const
export type Responsible = (typeof RESPONSIBLES)[number]
