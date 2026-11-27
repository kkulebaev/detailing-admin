import { PLATE_LETTERS } from '@/lib/license-plate'

// Данные для тестового заполнения формы записи (Ctrl+Shift+X, только в dev).

export const TEST_NAMES = [
  'Иван Петров',
  'Мария Смирнова',
  'Алексей Иванов',
  'Ольга Кузнецова',
  'Дмитрий Соколов',
]
export const TEST_NOTES = ['', 'Тестовая запись', 'Клиент просил перезвонить', 'Оплата картой']
const PLATE_LETTER_LIST = [...PLATE_LETTERS]

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function pickRandomMasters(arr: readonly string[], count: number): string[] {
  const pool = [...arr]
  const picked: string[] = []
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(idx, 1)[0]!)
  }
  return picked
}

export function randomDigits(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10)
  return out
}

export function randomPlate(): string {
  const l = () => pickRandom(PLATE_LETTER_LIST)
  const region = Math.random() < 0.5 ? randomDigits(2) : randomDigits(3)
  return `${l()}${randomDigits(3)}${l()}${l()}${region}`
}
