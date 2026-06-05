export function normalizePhone(raw: string): string {
  // Strip everything except digits and +
  const stripped = raw.replace(/[^\d+]/g, '')

  if (!stripped) return ''

  // Already canonical: +7 followed by exactly 10 digits
  if (/^\+7\d{10}$/.test(stripped)) return stripped

  // Pure digits only (no + sign)
  if (/^\d+$/.test(stripped)) {
    // 11 digits starting with 8 → replace 8 with +7
    if (stripped.length === 11 && stripped.startsWith('8')) {
      return '+7' + stripped.slice(1)
    }
    // 11 digits starting with 7 → prefix +
    if (stripped.length === 11 && stripped.startsWith('7')) {
      return '+' + stripped
    }
  }

  throw new Error('Невалидный номер: ' + raw)
}
