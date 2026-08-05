import type { DateValue } from 'reka-ui'

// Formats a reka-ui calendar date as the `DD.MM.YYYY` wire format the API
// expects — shared by every page with a date picker (bookings, work hours,
// analytics) so the conversion isn't reimplemented per component.
export function calToDdmmyyyy(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}
