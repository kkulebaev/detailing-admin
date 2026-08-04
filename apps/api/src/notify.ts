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

// Best-effort Telegram notification to every assigned master. Never throws —
// every failure mode collapses into `{ attempted: true, delivered: false, reason }`
// so the caller can surface a warning without failing the booking. Each master's
// chat id is resolved server-side by name (names are unique) rather than trusted
// from the client, so a request can't address an arbitrary chat.
//
// A booking can carry several masters who may share one Telegram chat, so chat
// ids are deduped before sending. The N per-master results collapse into one:
// `delivered` is true when at least one message lands, and `reason` carries the
// first failure seen (contract stays a single NotificationResult).
export async function notifyMaster(booking: Booking): Promise<NotificationResult> {
  if (!isDbReady()) {
    return { attempted: true, delivered: false, reason: 'db_unavailable' }
  }

  const chatIds = new Set<string>()
  try {
    for (const name of booking.master) {
      const master = await findMasterByName(name)
      const chatId = master?.telegramId?.trim()
      if (chatId) chatIds.add(chatId)
    }
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

  if (chatIds.size === 0) {
    return { attempted: true, delivered: false, reason: 'no_telegram_id' }
  }

  const message = formatMasterNotification(booking)
  let delivered = false
  let firstReason: string | undefined
  for (const chatId of chatIds) {
    const sent = await sendTelegramMessage(chatId, message)
    if (sent.ok) {
      delivered = true
    } else if (!firstReason) {
      firstReason = sent.reason ?? 'send_failed'
    }
  }

  if (delivered) {
    return { attempted: true, delivered: true }
  }
  return { attempted: true, delivered: false, reason: firstReason ?? 'send_failed' }
}
