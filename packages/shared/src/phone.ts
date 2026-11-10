export function normalizePhone(raw: string): string {
  // Выкидываем всё, кроме цифр и +
  const stripped = raw.replace(/[^\d+]/g, '')

  if (!stripped) return ''

  // Уже канонический: +7 и ровно 10 цифр
  if (/^\+7\d{10}$/.test(stripped)) return stripped

  // Только цифры (без знака +)
  if (/^\d+$/.test(stripped)) {
    // 11 цифр, начинается с 8 → заменяем 8 на +7
    if (stripped.length === 11 && stripped.startsWith('8')) {
      return '+7' + stripped.slice(1)
    }
    // 11 цифр, начинается с 7 → добавляем + в начало
    if (stripped.length === 11 && stripped.startsWith('7')) {
      return '+' + stripped
    }
  }

  throw new Error('Невалидный номер: ' + raw)
}
