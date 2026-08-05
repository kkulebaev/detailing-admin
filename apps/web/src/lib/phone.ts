// Renders a stored E.164 phone (`+7XXXXXXXXXX`) as `+7-XXX-XXX-XX-XX` for
// display — shared by every page that lists client phones (bookings,
// analytics) so the grouping isn't reimplemented per component. Returns the
// input unchanged when it doesn't end in the expected 10-digit tail.
export function formatPhone(raw: string): string {
  const match = /^(.+?)(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(raw)
  if (!match) return raw
  const [, prefix, a, b, c, d] = match
  return `${prefix}-${a}-${b}-${c}-${d}`
}
