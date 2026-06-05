export function parseDdmmyyyy(s: string): Date {
  const parts = s.split('.')
  if (parts.length !== 3) throw new Error('Invalid DD.MM.YYYY: ' + s)

  const d = parseInt(parts[0]!, 10)
  const m = parseInt(parts[1]!, 10)
  const y = parseInt(parts[2]!, 10)

  if (isNaN(d) || isNaN(m) || isNaN(y)) throw new Error('Invalid DD.MM.YYYY: ' + s)

  const date = new Date(Date.UTC(y, m - 1, d))

  // Bounds-check via re-formatting: if the date rolled over, the parts won't match
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error('Invalid DD.MM.YYYY: ' + s)
  }

  return date
}

export function formatDdmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getUTCFullYear())
  return `${dd}.${mm}.${yyyy}`
}
