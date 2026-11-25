import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    VAPID_PUBLIC_KEY: 'BPublic',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:owner@example.com',
  },
}))

import { sendNotification } from 'web-push'
import { sendPush } from '../src/notifications/web-push.js'

describe('test/setup.ts — изоляция web-push', () => {
  it('VAPID из окружения разработчика в тесты не попадает', () => {
    expect(process.env.VAPID_PUBLIC_KEY).toBeUndefined()
    expect(process.env.VAPID_PRIVATE_KEY).toBeUndefined()
    expect(process.env.VAPID_SUBJECT).toBeUndefined()
  })

  it('настоящий sendNotification замокан и в сеть не ходит', async () => {
    const res = await sendPush(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'p', auth: 'a' },
      { title: 't', body: 'b', link: '/', tag: 'x', unread: 0 },
      'topic',
    )
    expect(vi.isMockFunction(sendNotification)).toBe(true)
    expect(sendNotification).toHaveBeenCalledOnce()
    expect(res).toEqual({ ok: false, status: null, gone: false })
  })
})
