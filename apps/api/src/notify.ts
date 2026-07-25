import type { Booking } from '@detailing-admin/shared/booking'
import type { NotificationResult } from '@detailing-admin/shared'
import { isDbReady } from './boot.js'
import { findMasterByName } from './db/masters.js'
import { sendTelegramMessage, escapeHtml } from './telegram.js'
import { baseLogger } from './log.js'

// Human-readable date/time line for the master. Single-day bookings collapse to
// «дата, время»; ranges render «начало — конец» with whatever times are present
// (mirrors how the sheet's column A is built, but for humans, not Sheets).
function formatDateLine(b: Booking): string {
  if (b.dateTo) {
    const start = b.time ? `${b.dateFrom} ${b.time}` : b.dateFrom
    const end = b.timeTo ? `${b.dateTo} ${b.timeTo}` : b.dateTo
    return `${start} — ${end}`
  }
  return b.time ? `${b.dateFrom}, ${b.time}` : b.dateFrom
}

export function formatMasterNotification(b: Booking): string {
  return [
    '<b>🔔 Новая запись</b>',
    '',
    `📅 ${escapeHtml(formatDateLine(b))}`,
    `👤 ${escapeHtml(b.name)}`,
    `📞 ${escapeHtml(b.phone)}`,
    `🚗 ${escapeHtml(b.car)}`,
    `🛠 ${escapeHtml(b.service)}`,
  ].join('\n')
}

// Best-effort Telegram notification to the assigned master. Never throws — every
// failure mode collapses into `{ attempted: true, delivered: false, reason }`
// so the caller can surface a warning without failing the booking. The master's
// chat id is resolved server-side by name (names are unique) rather than trusted
// from the client, so a request can't address an arbitrary chat.
export async function notifyMaster(booking: Booking): Promise<NotificationResult> {
  if (!isDbReady()) {
    return { attempted: true, delivered: false, reason: 'db_unavailable' }
  }

  let chatId: string | undefined
  try {
    const master = await findMasterByName(booking.master)
    chatId = master?.telegramId?.trim() || undefined
  } catch (err) {
    baseLogger.warn(
      {
        event: 'booking.notify_lookup_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      'Master lookup for notification failed',
    )
    return { attempted: true, delivered: false, reason: 'lookup_failed' }
  }

  if (!chatId) {
    return { attempted: true, delivered: false, reason: 'no_telegram_id' }
  }

  const sent = await sendTelegramMessage(chatId, formatMasterNotification(booking))
  if (!sent.ok) {
    return { attempted: true, delivered: false, reason: sent.reason ?? 'send_failed' }
  }
  return { attempted: true, delivered: true }
}
