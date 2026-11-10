// Российский номер: 1 буква + 3 цифры + 2 буквы + 2–3 цифры (регион).
// Допустимы только буквы, совпадающие по начертанию с латиницей; латинские двойники
// транслитерируются, чтобы ошибка раскладки не мешала вводу.
export const PLATE_LETTERS = new Set(['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'])

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
}

export function maskLicensePlate(raw: string): string {
  let out = ''
  for (const ch of raw.toUpperCase()) {
    if (out.length >= 9) break
    const c = LATIN_TO_CYRILLIC[ch] ?? ch
    const pos = out.length
    const expectsLetter = pos === 0 || pos === 4 || pos === 5
    if (expectsLetter) {
      if (PLATE_LETTERS.has(c)) out += c
    } else if (/\d/.test(c)) {
      out += c
    }
  }
  return out
}
