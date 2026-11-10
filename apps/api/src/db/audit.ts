import {
  BOOKING_AUDITED_FIELDS,
  type AuditChange,
  type AuditValue,
  type BookingAuditAction,
} from '@detailing-admin/shared/booking-audit'
import type { Db } from './client.js'
import { auditLog, type Booking, type BookingSnapshot } from './schema.js'

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface AuditActor {
  id: string | null
  login: string
  name: string
}

export const BOOKING_ENTITY = 'booking'

export async function recordBookingAudit(
  db: Db | Tx,
  actor: AuditActor,
  bookingId: string,
  action: BookingAuditAction,
  extra: { changes?: AuditChange[]; snapshot?: BookingSnapshot } = {},
): Promise<void> {
  await db.insert(auditLog).values({
    entity: BOOKING_ENTITY,
    entityId: bookingId,
    action,
    actorId: actor.id,
    actorLogin: actor.login,
    actorName: actor.name,
    changes: extra.changes ?? null,
    snapshot: extra.snapshot ?? null,
  })
}

function sameValue(a: AuditValue, b: AuditValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  return a === b
}

/** Изменившиеся поля записи в порядке `BOOKING_AUDITED_FIELDS`. Пустой массив значит,
 * что сохранили без изменений, — такую правку в журнал не пишем. */
export function diffBookings(before: Booking, after: Booking): AuditChange[] {
  const changes: AuditChange[] = []
  for (const field of BOOKING_AUDITED_FIELDS) {
    const from: AuditValue = before[field]
    const to: AuditValue = after[field]
    if (!sameValue(from, to)) changes.push({ field, from, to })
  }
  return changes
}
