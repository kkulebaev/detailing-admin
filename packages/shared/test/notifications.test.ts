import { describe, expect, it } from 'vitest'
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../src/notifications.js'

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
