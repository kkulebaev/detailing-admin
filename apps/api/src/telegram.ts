import { env } from './env.js'
import { baseLogger } from './log.js'

export interface TelegramSendResult {
  ok: boolean
  // Terse, PII-free failure reason (Telegram `description`, HTTP status, or
  // 'timeout'). Never contains the message text.
  reason?: string
}

// Injectable transport so tests never touch the network. Defaults to the global
// fetch (Node 22+); mirrors the `_setClientForTest` seam in sheets.ts.
type Fetcher = typeof fetch
let _fetch: Fetcher = fetch

/** For tests only — lets tests stub the HTTP transport. */
export function _setFetchForTest(fn: Fetcher): void {
  _fetch = fn
}

const TIMEOUT_MS = 5000

// HTML parse_mode requires these three to be escaped in user-supplied text;
// leaving them raw would break rendering or let a name inject markup.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await _fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let reason = `http_${res.status}`
      try {
        const body: unknown = await res.json()
        if (
          body !== null &&
          typeof body === 'object' &&
          'description' in body &&
          typeof body.description === 'string'
        ) {
          reason = body.description
        }
      } catch {
        // Non-JSON error body — keep the http_<status> fallback.
      }
      baseLogger.warn(
        { event: 'telegram.send_failed', status: res.status, reason },
        'Telegram sendMessage returned non-2xx',
      )
      return { ok: false, reason }
    }
    return { ok: true }
  } catch (err) {
    const reason =
      err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err)
    baseLogger.warn({ event: 'telegram.send_error', reason }, 'Telegram sendMessage threw')
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
