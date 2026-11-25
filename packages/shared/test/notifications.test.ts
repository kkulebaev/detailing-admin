import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  pushSubscriptionInputSchema,
} from '../src/notifications.js'

describe('NOTIFICATION_CHANNELS', () => {
  it('задает каналы каждому типу, и лента есть у всех', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CHANNELS[type]).toContain('feed')
    }
  })

  it('события по записям не уходят в Telegram, остальные уходят', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CHANNELS[type].includes('telegram')).toBe(!type.startsWith('booking.'))
    }
  })
})

describe('pushSubscriptionInputSchema — только push-сервисы (SSRF)', () => {
  const keys = { p256dh: 'p', auth: 'a' }
  const ok = (endpoint: string) => pushSubscriptionInputSchema.safeParse({ endpoint, keys }).success

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGr1',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])('принимает %s', (endpoint) => {
    expect(ok(endpoint)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:3000/api',
    'https://evilpush.apple.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://push.apple.com@evil.com/x',
    'not a url',
  ])('отклоняет %s', (endpoint) => {
    expect(ok(endpoint)).toBe(false)
  })
})
