import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/boot.js', () => ({
  isDbReady: vi.fn().mockReturnValue(true),
}))

vi.mock('../src/db/masters.js', () => ({
  findMasterByName: vi.fn(),
}))

vi.mock('../src/telegram.js', () => ({
  sendTelegramMessage: vi.fn(),
  // Настоящее экранирование, чтобы вывод formatMasterNotification был достоверным.
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
  master: ['Петр'],
  responsible: 'Петр',
  carClass: 3,
  notify: true,
} as unknown as Booking

const MASTER = {
  id: 1,
  name: 'Петр',
  position: 0,
  canBeResponsible: true,
  paidSalary: true,
  archived: false,
  telegramId: '55555',
  userId: null,
}

describe('formatMasterNotification', () => {
  it('выводит однодневную запись с датой, именем, телефоном, машиной и услугой', () => {
    const text = formatMasterNotification(BOOKING)
    expect(text).toContain('04.06.2026, 10:00')
    expect(text).toContain('Иван')
    expect(text).toContain('+79991234567')
    expect(text).toContain('Toyota Camry')
    expect(text).toContain('Полировка')
  })

  it('выводит диапазон в виде «начало — конец»', () => {
    const text = formatMasterNotification({
      ...BOOKING,
      dateTo: '06.06.2026',
      timeTo: '18:00',
    } as unknown as Booking)
    expect(text).toContain('04.06.2026 10:00 — 06.06.2026 18:00')
  })

  it('экранирует значимые для HTML символы в пользовательских полях', () => {
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

  it('сообщает db_unavailable и не ищет мастера, если БД недоступна', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'db_unavailable' })
    expect(vi.mocked(findMasterByName)).not.toHaveBeenCalled()
  })

  it('сообщает no_telegram_id, если у мастера нет chat id', async () => {
    vi.mocked(findMasterByName).mockResolvedValue({ ...MASTER, telegramId: null })
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'no_telegram_id' })
    expect(vi.mocked(sendTelegramMessage)).not.toHaveBeenCalled()
  })

  it('сообщает no_telegram_id, если имя мастера не найдено', async () => {
    vi.mocked(findMasterByName).mockResolvedValue(undefined)
    const result = await notifyMaster(BOOKING)
    expect(result.reason).toBe('no_telegram_id')
  })

  it('сообщает lookup_failed, если запрос мастера бросает исключение', async () => {
    vi.mocked(findMasterByName).mockRejectedValue(new Error('db error'))
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'lookup_failed' })
  })

  it('доставляет в найденный chat id', async () => {
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('55555', expect.any(String))
  })

  it('пробрасывает причину сбоя отправки', async () => {
    vi.mocked(sendTelegramMessage).mockResolvedValue({ ok: false, reason: 'timeout' })
    const result = await notifyMaster(BOOKING)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'timeout' })
  })

  const MULTI = { ...BOOKING, master: ['Петр', 'Иван'] } as unknown as Booking

  it('отправляет в чат каждого мастера и сводит итог к одному delivered', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Петр' ? MASTER : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('55555', expect.any(String))
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith('77777', expect.any(String))
  })

  it('убирает дубли мастеров с общим chat id — отправляет один раз', async () => {
    // Оба мастера указывают на один и тот же чат в Telegram.
    vi.mocked(findMasterByName).mockResolvedValue(MASTER)
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledTimes(1)
  })

  it('сводит итог к delivered, если сообщение получил хотя бы один мастер', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Петр' ? MASTER : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    vi.mocked(sendTelegramMessage).mockImplementation(async (chatId: string) =>
      chatId === '55555' ? { ok: false, reason: 'timeout' } : { ok: true },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: true })
  })

  it('сообщает причину первого сбоя, если все отправки неудачны', async () => {
    vi.mocked(findMasterByName).mockImplementation(async (name: string) =>
      name === 'Петр' ? MASTER : { ...MASTER, id: 2, name: 'Иван', telegramId: '77777' },
    )
    vi.mocked(sendTelegramMessage).mockImplementation(async (chatId: string) =>
      chatId === '55555' ? { ok: false, reason: 'timeout' } : { ok: false, reason: 'blocked' },
    )
    const result = await notifyMaster(MULTI)
    expect(result).toEqual({ attempted: true, delivered: false, reason: 'timeout' })
  })
})
