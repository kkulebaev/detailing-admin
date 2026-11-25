import { describe, expect, it } from 'vitest'
import {
  bookingNotifications,
  moneyNotifications,
  scheduleRequestCreatedNotifications,
  scheduleRequestDecidedNotifications,
  type BookingSummary,
} from '../src/notifications/events.js'

const booking: BookingSummary = {
  id: 'bk1',
  name: 'Иван',
  car: 'Kia Rio',
  service: 'Полировка',
  dateFrom: '2026-11-26',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
}

const accounts = new Map([
  [1, { userId: 'uA' }],
  [2, { userId: 'uB' }],
  [3, { userId: 'uC' }],
])

describe('bookingNotifications', () => {
  it('создание: назначенным мастерам booking.assigned со ссылкой на запись', () => {
    expect(
      bookingNotifications({ kind: 'create', booking, masterIds: [1] }, accounts, 'u-admin'),
    ).toEqual([
      {
        userId: 'uA',
        type: 'booking.assigned',
        title: 'Новая запись',
        body: '26.11, 10:00 · Иван · Kia Rio · Полировка',
        pushBody: '26.11, 10:00 · Kia Rio · Полировка',
        link: '/bookings?booking=bk1',
      },
    ])
  })

  it('в пуше нет имени клиента, в ленте есть (6l)', () => {
    const [d] = bookingNotifications({ kind: 'create', booking, masterIds: [1] }, accounts, null)
    expect(d!.body).toContain('Иван')
    expect(d!.pushBody).not.toContain('Иван')
  })

  it('автор не получает уведомление о своем действии (6a)', () => {
    expect(
      bookingNotifications({ kind: 'create', booking, masterIds: [1, 2] }, accounts, 'uA'),
    ).toMatchObject([{ userId: 'uB' }])
  })

  it('мастер без аккаунта не получает ничего', () => {
    expect(
      bookingNotifications({ kind: 'create', booking, masterIds: [9] }, accounts, null),
    ).toEqual([])
  })

  it('удаление и восстановление', () => {
    expect(
      bookingNotifications({ kind: 'delete', booking, masterIds: [1] }, accounts, null),
    ).toMatchObject([{ type: 'booking.unassigned', title: 'Запись удалена', link: '/bookings' }])
    expect(
      bookingNotifications({ kind: 'restore', booking, masterIds: [1] }, accounts, null),
    ).toMatchObject([{ type: 'booking.assigned', title: 'Запись восстановлена' }])
  })

  it('правка: добавлен A, снят B, перенесена дата, C остался — каждому по одному (6b)', () => {
    const drafts = bookingNotifications(
      {
        kind: 'update',
        before: booking,
        after: { ...booking, dateFrom: '2026-11-27' },
        beforeMasterIds: [2, 3],
        afterMasterIds: [1, 3],
      },
      accounts,
      'u-admin',
    )
    expect(drafts.map((d) => [d.userId, d.type])).toEqual([
      ['uA', 'booking.assigned'],
      ['uB', 'booking.unassigned'],
      ['uC', 'booking.changed'],
    ])
    // Снятому показываем прежнюю дату, оставшемуся — новую.
    expect(drafts[1]!.body).toContain('26.11')
    expect(drafts[2]!.body).toContain('27.11')
  })

  it('правка без изменений важных мастеру полей ничего не создает (критерий 2)', () => {
    expect(
      bookingNotifications(
        {
          kind: 'update',
          before: booking,
          after: { ...booking },
          beforeMasterIds: [1],
          afterMasterIds: [1],
        },
        accounts,
        null,
      ),
    ).toEqual([])
  })

  it('перенос времени у оставшегося мастера — booking.changed', () => {
    expect(
      bookingNotifications(
        {
          kind: 'update',
          before: booking,
          after: { ...booking, timeFrom: '12:00', timeTo: '15:00' },
          beforeMasterIds: [1],
          afterMasterIds: [1],
        },
        accounts,
        null,
      ),
    ).toMatchObject([{ type: 'booking.changed', body: expect.stringContaining('12:00–15:00') }])
  })

  it('многодневная запись показывает диапазон дат, длинная услуга обрезается', () => {
    const [d] = bookingNotifications(
      {
        kind: 'create',
        booking: { ...booking, dateTo: '2026-11-28', service: 'а'.repeat(200) },
        masterIds: [1],
      },
      accounts,
      null,
    )
    expect(d!.body.startsWith('26.11–28.11, 10:00')).toBe(true)
    expect(d!.body.endsWith('…')).toBe(true)
  })
})

describe('заявки на график', () => {
  it('новая заявка — всем админам, кроме автора (критерий 5)', () => {
    const drafts = scheduleRequestCreatedNotifications(
      { masterName: 'Иван', dayCount: 3 },
      ['u-admin', 'u-admin2'],
      'u-admin',
    )
    expect(drafts).toEqual([
      {
        userId: 'u-admin2',
        type: 'schedule_request.created',
        title: 'Новая заявка на график',
        body: 'Иван просит изменить график: 3 дня',
        link: '/schedule',
        pushBody: null,
      },
    ])
  })

  it('склоняет число дней', () => {
    const body = (n: number) =>
      scheduleRequestCreatedNotifications({ masterName: 'И', dayCount: n }, ['a'], null)[0]!.body
    expect(body(1)).toMatch(/1 день$/)
    expect(body(5)).toMatch(/5 дней$/)
    expect(body(11)).toMatch(/11 дней$/)
    expect(body(22)).toMatch(/22 дня$/)
  })

  it('отказ доходит до мастера с комментарием', () => {
    expect(
      scheduleRequestDecidedNotifications(
        { approve: false, comment: 'В эти дни аврал', dayCount: 2 },
        'u-emp',
        'u-admin',
      ),
    ).toMatchObject([
      {
        userId: 'u-emp',
        type: 'schedule_request.decided',
        title: 'Заявка на график отклонена',
        body: 'Комментарий: В эти дни аврал',
      },
    ])
  })

  it('без аккаунта или своему решению — ничего', () => {
    const d = { approve: true, comment: null, dayCount: 1 }
    expect(scheduleRequestDecidedNotifications(d, null, 'u-admin')).toEqual([])
    expect(scheduleRequestDecidedNotifications(d, 'u-admin', 'u-admin')).toEqual([])
  })
})

describe('moneyNotifications', () => {
  const employee = { userId: 'u-emp', role: 'employee' as const }

  it('выплата с суммой и ссылкой на «Мои часы» (критерий 6)', () => {
    const [d] = moneyNotifications(
      {
        type: 'payout.changed',
        action: 'create',
        payout: { payoutDate: '2026-11-20', amount: 5000, note: 'премия' },
      },
      employee,
      'u-admin',
    )
    expect(d).toMatchObject({
      type: 'payout.changed',
      title: 'Выплата добавлена',
      link: '/employee',
    })
    expect(d!.body).toMatch(/^5\s000 ₽ · 20\.11\.2026 · премия$/)
  })

  it('удержание называется удержанием и несет минус', () => {
    const [d] = moneyNotifications(
      {
        type: 'payout.changed',
        action: 'delete',
        payout: { payoutDate: '2026-11-20', amount: -500, note: '' },
      },
      employee,
      null,
    )
    expect(d).toMatchObject({ title: 'Удержание удалено', body: '−500 ₽ · 20.11.2026' })
  })

  it('админу ссылка ведет в «Зарплаты»: /employee ему закрыт', () => {
    const [d] = moneyNotifications(
      {
        type: 'work_hours.changed',
        action: 'update',
        hours: { workDate: '2026-11-20', minutes: 450 },
      },
      { userId: 'u-admin2', role: 'admin' },
      'u-admin',
    )
    expect(d).toMatchObject({
      title: 'Часы изменены',
      body: '20.11.2026: 7,5 ч',
      link: '/salaries',
    })
  })

  it('мастер без аккаунта или правка самому себе — ничего', () => {
    const e = {
      type: 'work_hours.changed' as const,
      action: 'create' as const,
      hours: { workDate: '2026-11-20', minutes: 60 },
    }
    expect(moneyNotifications(e, null, 'u-admin')).toEqual([])
    expect(moneyNotifications(e, { userId: 'u-admin', role: 'admin' }, 'u-admin')).toEqual([])
  })
})
