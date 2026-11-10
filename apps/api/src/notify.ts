import type { Booking } from '@detailing-admin/shared/booking'
import type { NotificationResult } from '@detailing-admin/shared'
import { isDbReady } from './boot.js'
import { findMasterByName } from './db/masters.js'
import { sendTelegramMessage, escapeHtml } from './telegram.js'
import { baseLogger } from './log.js'

// Человекочитаемая строка даты/времени для мастера. Однодневная запись сворачивается в
// «дата, время»; диапазон выводится как «начало — конец» с теми временами, что заданы
// (повторяет сборку столбца A таблицы, но для людей, а не для Sheets).
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

// Best-effort уведомление в Telegram каждому назначенному мастеру. Никогда не бросает —
// любой сбой сводится к `{ attempted: true, delivered: false, reason }`, чтобы
// вызывающий код мог показать предупреждение, не проваливая запись. Chat id каждого
// мастера определяется на сервере по имени (имена уникальны), а не берется на веру
// от клиента, поэтому запрос не может адресовать произвольный чат.
//
// В записи может быть несколько мастеров с общим чатом в Telegram, поэтому chat id
// перед отправкой дедуплицируются. N результатов по мастерам сводятся в один:
// `delivered` равен true, если дошло хотя бы одно сообщение, а `reason` несет
// первый встреченный сбой (контракт остается одним NotificationResult).
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
