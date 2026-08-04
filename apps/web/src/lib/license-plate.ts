// Russian plate: 1 letter + 3 digits + 2 letters + 2–3 digits (region).
// Only letters shared with Latin glyphs are legal; Latin look-alikes are
// transliterated so a keyboard layout slip doesn't block typing.
export const PLATE_LETTERS = new Set(['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'])

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н',
  O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
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
