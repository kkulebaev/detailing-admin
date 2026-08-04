import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/boot.js', () => ({
  isDbReady: vi.fn().mockReturnValue(true),
}))

vi.mock('../src/db/masters.js', () => ({
  findMasterByName: vi.fn(),
}))

vi.mock('../src/telegram.js', () => ({
  sendTelegramMessage: vi.fn(),
  // Real escaping so formatMasterNotification output is faithful.
  escapeHtml: (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}))

vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

import { notifyMaster, formatMasterNotification } from '../src/notify.js'
import { isDbReady } from '../src/boot.js'
import { findMasterByName } from '../src/db/masters.js'
import { sendTelegramMessage } from '../src/telegram.js'

type Booking = Parameters<typeof formatMasterNotification>[0]

const BOOKING = {
  dateFrom: '04.06.2026',
  time: '10:00',
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  note: '',
  amount: 5000,
  readiness: '',
  master: ['Пётр'],
  responsible: 'Пётр',
  carClass: 3,
  notify: true,
} as unknown as Booking

const MASTER = {
  id: 1,
  name: 'Пётр',
  position: 0,
  canBeResponsible: true,
  paidSalary: true,
  telegramId: '55555',
}

describe('formatMasterNotification', () => {
  it('renders a single-day booking with date, name, phone, car and service', () => {
    const text = formatMasterNotification(BOOKING)
    expect(text).toContain('04.06.2026, 10:00')
    expect(text).toContain('Иван')
    expect(text).toContain('+79991234567')
    expect(text).toContain('Toyota Camry')
    expect(text).toContain('Полировка')
  })

  it('renders a range with «начало — конец»', () => {
    const text = formatMasterNotification({
      ...BOOKING,
      dateTo: '06.06.2026',
      timeTo: '18:00',
    } as unknown as Booking)
    expect(text).toContain('04.06.2026 10:00 — 06.06.2026 18:00')
  })

  it('escapes HTML-significant characters in user fields', () => {
    const text = formatMasterNotification({ ...BOOKING, name: 'A & <b>' } as unknown as Booking)
    expect(text).toContain('A &amp; &lt;b&gt;')
  })
})

describe('notifyMaster', () => {
  beforeEach(() => {
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(findMasterByName).mockResolvedValue(MASTER)
    vi.mocked(sendTelegramMessage).mockResolvedValue({ ok: true })
  })

  it('reports db_unavailable and never looks up the master when DB is down', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'db_unavailable' })
    expect(vi.mocked(findMasterByName)).not.toHaveBeenCalled()
  })

  it('reports no_telegram_id when the master has no chat id', async () => {
    vi.mocked(findMasterByName).mockResolvedValue({ ...MASTER, telegramId: null })
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'no_telegram_id' })
    expect(vi.mocked(sendTelegramMessage)).not.toHaveBeenCalled()
  })

  it('reports no_telegram_id when the master name is not found', async () => {
    vi.mocked(findMasterByName).mockResolvedValue(undefined)
    const result = await notifyMaster(BOOKING)
    expect(result.reason).toBe('no_telegram_id')
  })

  it('reports lookup_failed when the master query throws', async () => {
    vi.mocked(findMasterByName).mockRejectedValue(new Error('db error'))
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'lookup_failed' })
  })

  it('delivers to the resolved chat id', async () => {
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('55555', expect.any(String))
  })

  it('propagates the send failure reason', async () => {
    vi.mocked(sendTelegramMessage).mockResolvedValue({ ok: false, reason: 'timeout' })
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'timeout' })
  })

  const MULTI = { ...BOOKING, master: ['Пётр', 'Иван'] } as unknown as Booking

  it('sends to each distinct master chat and collapses to one delivered result', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Пётр'
        ? MASTER
        : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('55555', expect.any(String))
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('77777', expect.any(String))
  })

  it('dedups masters sharing one chat id — sends once', async () => {
    // Both masters resolve to the same telegram chat.
    vi.mocked(findMasterByName).mockResolvedValue(MASTER)
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledTimes(1)
  })

  it('collapses to delivered when at least one master receives the message', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Пётр'
        ? MASTER
        : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    vi.mocked(sendTelegramMessage).mockImplementation(async (chatId: string) =>
      chatId === '55555' ? { ok: false, reason: 'timeout' } : { ok: true },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
  })

  it('reports the first failure reason when every send fails', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Пётр'
        ? MASTER
        : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    vi.mocked(sendTelegramMessage).mockImplementation(async (chatId: string) =>
      chatId === '55555' ? { ok: false, reason: 'timeout' } : { ok: false, reason: 'blocked' },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'timeout' })
  })
})
