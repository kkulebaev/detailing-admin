import type { BookingRow, Readiness } from '@detailing-admin/shared'

// Single source for readiness status colours, two render targets: a pill badge
// (client-card history) and a full-row tint (bookings table). Both keyed by the
// same `Readiness` union — a mistyped status is a compile error, and recolouring
// a status touches one file instead of drifting between pages. Partial maps: not
// every status is coloured; '' and unlisted statuses fall back.

// Pill badge (bg-100 / text-800 pairs; «Выдана» muted as a finished job).
const READINESS_BADGE_CLASS: Partial<Record<Readiness, string>> = {
  'В работе': 'bg-orange-100 text-orange-800',
  Перенос: 'bg-violet-100 text-violet-800',
  Выдана: 'bg-zinc-100 text-zinc-600',
  'Не ответил': 'bg-rose-100 text-rose-800',
  Подтвердил: 'bg-green-100 text-green-800',
  'Не приехал': 'bg-red-200 text-red-900',
  Отмена: 'bg-amber-100 text-amber-800',
}

export function readinessBadgeClass(readiness: BookingRow['readiness']): string {
  if (!readiness) return 'bg-muted text-muted-foreground'
  return READINESS_BADGE_CLASS[readiness] ?? 'bg-muted text-muted-foreground'
}

// Full-row tint for the bookings table. `bg-*-100!` overrides the row hover;
// «Выдана» is muted (almost-white + grey text) so the eye tracks active statuses,
// not finished ones. Uncoloured statuses get the hover reset instead.
const READINESS_ROW_CLASS: Partial<Record<Readiness, string>> = {
  'В работе': 'bg-orange-100!',
  Перенос: 'bg-violet-100!',
  Выдана: 'bg-zinc-50! text-muted-foreground',
  'Не ответил': 'bg-rose-100!',
  Подтвердил: 'bg-green-100!',
  'Не приехал': 'bg-red-200!',
  Отмена: 'bg-amber-100!',
}

export function readinessRowClass(readiness: BookingRow['readiness']): string {
  if (!readiness) return 'hover:bg-transparent'
  return READINESS_ROW_CLASS[readiness] ?? 'hover:bg-transparent'
}
