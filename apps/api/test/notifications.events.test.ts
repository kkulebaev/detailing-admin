import { describe, expect, it } from 'vitest'
import {
  bookingNotifications,
  moneyNotifications,
  scheduleRequestCreatedNotifications,
  scheduleRequestDecidedNotifications,
  type BookingSummary,
  type MoneyEvent,
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
        title: 'У вас новая запись',
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
    ).toMatchObject([{ type: 'booking.unassigned', title: 'Запись отменили', link: '/bookings' }])
    expect(
      bookingNotifications({ kind: 'restore', booking, masterIds: [1] }, accounts, null),
    ).toMatchObject([{ type: 'booking.assigned', title: 'Отмененную запись вернули' }])
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
    expect(drafts.map((d) => [d.userId, d.type, d.title])).toEqual([
      ['uA', 'booking.assigned', 'Вас добавили в запись'],
      ['uB', 'booking.unassigned', 'Вас убрали из записи'],
      ['uC', 'booking.changed', 'Запись перенесена'],
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
    ).toMatchObject([
      {
        type: 'booking.changed',
        title: 'Изменилось время записи',
        body: expect.stringContaining('12:00–15:00'),
      },
    ])
  })

  describe('заголовок правки называет, что поменялось', () => {
    const changedTitle = (after: Partial<BookingSummary>) =>
      bookingNotifications(
        {
          kind: 'update',
          before: booking,
          after: { ...booking, ...after },
          beforeMasterIds: [1],
          afterMasterIds: [1],
        },
        accounts,
        null,
      ).map((d) => d.title)

    it('одна перемена', () => {
      expect(changedTitle({ dateTo: '2026-11-27' })).toEqual(['Запись перенесена'])
      expect(changedTitle({ timeTo: '12:00' })).toEqual(['Изменилось время записи'])
      expect(changedTitle({ car: 'Kia Ceed' })).toEqual(['Изменилось авто в записи'])
      expect(changedTitle({ service: 'Мойка' })).toEqual(['Изменилась услуга в записи'])
    })

    it('дата вместе со временем — это один перенос', () => {
      expect(changedTitle({ dateFrom: '2026-11-27', timeFrom: '12:00' })).toEqual([
        'Запись перенесена',
      ])
    })

    it('две перемены перечисляются', () => {
      expect(changedTitle({ dateFrom: '2026-11-27', car: 'Kia Ceed' })).toEqual([
        'Изменились дата и авто',
      ])
      expect(changedTitle({ timeFrom: '12:00', service: 'Мойка' })).toEqual([
        'Изменились время и услуга',
      ])
      expect(changedTitle({ car: 'Kia Ceed', service: 'Мойка' })).toEqual([
        'Изменились авто и услуга',
      ])
    })

    it('три и больше — общий заголовок', () => {
      expect(changedTitle({ dateFrom: '2026-11-27', car: 'Kia Ceed', service: 'Мойка' })).toEqual([
        'Изменились детали записи',
      ])
    })

    it('смена только имени клиента мастеру не интересна', () => {
      expect(changedTitle({ name: 'Петр' })).toEqual([])
    })
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
      { masterName: 'Иван', days: [{ working: true }, { working: true }, { working: false }] },
      ['u-admin', 'u-admin2'],
      'u-admin',
    )
    expect(drafts).toEqual([
      {
        userId: 'u-admin2',
        type: 'schedule_request.created',
        title: 'Заявка на изменение графика',
        body: 'Иван: 2 рабочих дня, 1 выходной',
        link: '/schedule',
        pushBody: null,
      },
    ])
  })

  it('склоняет число рабочих и выходных дней', () => {
    const days = (n: number, working: boolean) => Array.from({ length: n }, () => ({ working }))
    const body = (n: number, working: boolean) =>
      scheduleRequestCreatedNotifications(
        { masterName: 'И', days: days(n, working) },
        ['a'],
        null,
      )[0]!.body
    expect(body(1, true)).toBe('И: 1 рабочий день')
    expect(body(5, true)).toBe('И: 5 рабочих дней')
    expect(body(11, true)).toBe('И: 11 рабочих дней')
    expect(body(22, true)).toBe('И: 22 рабочих дня')
    expect(body(1, false)).toBe('И: 1 выходной')
    expect(body(3, false)).toBe('И: 3 выходных')
    expect(body(21, false)).toBe('И: 21 выходной')
  })

  it('одобрение говорит, что уже в графике', () => {
    expect(
      scheduleRequestDecidedNotifications(
        { approve: true, comment: null, days: [{ working: false }, { working: false }] },
        'u-emp',
        'u-admin',
      ),
    ).toMatchObject([{ title: 'Заявку на график одобрили', body: 'Уже в графике: 2 выходных' }])
  })

  it('отказ без комментария говорит, что график прежний', () => {
    expect(
      scheduleRequestDecidedNotifications(
        { approve: false, comment: '  ', days: [{ working: true }] },
        'u-emp',
        'u-admin',
      ),
    ).toMatchObject([{ title: 'Заявку на график отклонили', body: 'График остался прежним' }])
  })

  it('отказ доходит до мастера с комментарием', () => {
    expect(
      scheduleRequestDecidedNotifications(
        { approve: false, comment: 'В эти дни аврал', days: [{ working: true }] },
        'u-emp',
        'u-admin',
      ),
    ).toMatchObject([
      {
        userId: 'u-emp',
        type: 'schedule_request.decided',
        title: 'Заявку на график отклонили',
        body: 'Причина: В эти дни аврал',
      },
    ])
  })

  it('без аккаунта или своему решению — ничего', () => {
    const d = { approve: true, comment: null, days: [{ working: true }] }
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
      title: 'Новая выплата',
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
    expect(d).toMatchObject({ title: 'Удержание удалили', body: '−500 ₽ · 20.11.2026' })
  })

  it('создание, правка и удаление называются по-разному', () => {
    const payout = { payoutDate: '2026-11-20', amount: 1000, note: '' }
    const title = (e: MoneyEvent) => moneyNotifications(e, employee, null)[0]!.title
    expect(title({ type: 'payout.changed', action: 'create', payout })).toBe('Новая выплата')
    expect(title({ type: 'payout.changed', action: 'update', payout, before: payout })).toBe(
      'Выплату изменили',
    )
    expect(title({ type: 'payout.changed', action: 'delete', payout })).toBe('Выплату удалили')
    const minus = { ...payout, amount: -1000 }
    expect(title({ type: 'payout.changed', action: 'create', payout: minus })).toBe(
      'Новое удержание',
    )
    expect(title({ type: 'payout.changed', action: 'update', payout: minus, before: minus })).toBe(
      'Удержание изменили',
    )
    const hours = { workDate: '2026-11-20', minutes: 60 }
    expect(title({ type: 'work_hours.changed', action: 'create', hours })).toBe('Вам записали часы')
    expect(title({ type: 'work_hours.changed', action: 'delete', hours })).toBe('Ваши часы удалили')
  })

  it('сумма удержания со знаком идет первой: по ней лента узнает удержание', () => {
    const [d] = moneyNotifications(
      {
        type: 'payout.changed',
        action: 'create',
        payout: { payoutDate: '2026-11-20', amount: -1500, note: 'опоздание' },
      },
      employee,
      null,
    )
    expect(d!.body).toMatch(/^−1\s500 ₽ · 20\.11\.2026 · опоздание$/)
  })

  it('правка выплаты показывает прежние сумму и дату, если они поменялись', () => {
    const before = { payoutDate: '2026-11-20', amount: 4000, note: 'премия' }
    const body = (payout: typeof before) =>
      moneyNotifications(
        { type: 'payout.changed', action: 'update', payout, before },
        employee,
        null,
      )[0]!.body
    expect(body({ ...before, amount: 5000 })).toMatch(
      /^5\s000 ₽ \(было 4\s000 ₽\) · 20\.11\.2026 · премия$/,
    )
    expect(body({ ...before, payoutDate: '2026-11-21' })).toMatch(
      /^4\s000 ₽ · 21\.11\.2026 \(было 20\.11\.2026\) · премия$/,
    )
    expect(body({ ...before, note: 'бонус' })).toMatch(/^4\s000 ₽ · 20\.11\.2026 · бонус$/)
  })

  it('правка часов показывает прежнее значение', () => {
    const before = { workDate: '2026-11-20', minutes: 480 }
    const body = (hours: typeof before) =>
      moneyNotifications(
        { type: 'work_hours.changed', action: 'update', hours, before },
        employee,
        null,
      )[0]!.body
    expect(body({ ...before, minutes: 510 })).toBe('8,5 ч (было 8 ч) за 20.11.2026')
    expect(body({ ...before, workDate: '2026-11-21' })).toBe('8 ч за 21.11.2026 (было 20.11.2026)')
  })

  it('админу ссылка ведет в «Зарплаты»: /employee ему закрыт', () => {
    const [d] = moneyNotifications(
      {
        type: 'work_hours.changed',
        action: 'update',
        hours: { workDate: '2026-11-20', minutes: 450 },
        before: { workDate: '2026-11-20', minutes: 450 },
      },
      { userId: 'u-admin2', role: 'admin' },
      'u-admin',
    )
    expect(d).toMatchObject({
      title: 'Ваши часы изменили',
      body: '7,5 ч за 20.11.2026',
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
