import { describe, expect, it } from 'vitest'
import { scrubBreadcrumb, scrubOutgoingUrl } from '../src/sentry-scrub.js'

describe('scrubOutgoingUrl', () => {
  it('hides the bot token in Bot API paths', () => {
    expect(scrubOutgoingUrl('https://api.telegram.org/bot123:ABC-def/sendMessage')).toBe(
      'https://api.telegram.org/bot[Filtered]/sendMessage',
    )
  })

  it('keeps only the origin of a push endpoint', () => {
    expect(scrubOutgoingUrl('https://fcm.googleapis.com/fcm/send/device-token')).toBe(
      'https://fcm.googleapis.com',
    )
  })

  it('drops the query string', () => {
    expect(scrubOutgoingUrl('https://sheets.googleapis.com/v4/values?key=secret')).toBe(
      'https://sheets.googleapis.com/v4/values',
    )
  })

  it('does not echo an unparsable url', () => {
    expect(scrubOutgoingUrl('bot123:ABC')).toBe('[unparsable url]')
  })
})

describe('scrubBreadcrumb', () => {
  it('rewrites data.url and keeps the rest', () => {
    expect(
      scrubBreadcrumb({
        category: 'http',
        data: { url: 'https://api.telegram.org/botT/getUpdates?offset=1', status_code: 200 },
      }),
    ).toEqual({
      category: 'http',
      data: { url: 'https://api.telegram.org/bot[Filtered]/getUpdates', status_code: 200 },
    })
  })

  it('leaves breadcrumbs without a url alone', () => {
    const breadcrumb = { category: 'console', message: 'hi' }
    expect(scrubBreadcrumb(breadcrumb)).toBe(breadcrumb)
  })
})
