import { assert, describe, it, expect } from 'vitest'
import {
  SELF_EDIT_WINDOW_DAYS,
  computeSalary,
  isInSelfEditWindow,
  selfEditWindow,
  hoursToMinutes,
  mergeSalaryEntries,
  minutesToHours,
  monthRange,
  monthSchema,
  payoutInputSchema,
  payoutUpdateSchema,
  rateInputSchema,
  salaryEntryDate,
  salaryFromMinutesRateSum,
  workHoursInputSchema,
  workHoursUpdateSchema,
  type Payout,
  type WorkHours,
} from '../src/salaries.js'

describe('hoursToMinutes', () => {
  it('убирает «пыль» float округлением (7.51 → 451, а не 450)', () => {
    expect(hoursToMinutes(7.51)).toBe(451)
  })

  it('чисто переводит ровные четверти часа', () => {
    expect(hoursToMinutes(7.5)).toBe(450)
    expect(hoursToMinutes(0.25)).toBe(15)
    expect(hoursToMinutes(8)).toBe(480)
  })
})

describe('minutesToHours', () => {
  it('обращает hoursToMinutes для значений с шагом в четверть часа', () => {
    expect(minutesToHours(450)).toBe(7.5)
    expect(minutesToHours(15)).toBe(0.25)
  })
})

describe('computeSalary — одно округление на месяц', () => {
  it('округляет итог месяца один раз: 2×25мин × 100₽/ч → 83, а не 84', () => {
    // Построчное округление дало бы round(2500/60)=42 дважды = 84; правильный
    // ответ — один раз round(5000/60) = 83.
    const entries = [
      { minutes: 25, rate: 100 },
      { minutes: 25, rate: 100 },
    ]
    expect(computeSalary(entries)).toBe(83)
  })

  it('суммирует по разным снапшотам ставки (смена ставки посреди месяца)', () => {
    // 60мин@100 + 60мин@200 = 6000+12000 = 18000 ₽·мин / 60 = 300 ₽
    const entries = [
      { minutes: 60, rate: 100 },
      { minutes: 60, rate: 200 },
    ]
    expect(computeSalary(entries)).toBe(300)
  })

  it('дает ноль без записей', () => {
    expect(computeSalary([])).toBe(0)
  })

  it('совпадает с salaryFromMinutesRateSum на агрегате', () => {
    const entries = [
      { minutes: 25, rate: 100 },
      { minutes: 25, rate: 100 },
    ]
    const sum = entries.reduce((a, e) => a + e.minutes * e.rate, 0)
    expect(salaryFromMinutesRateSum(sum)).toBe(computeSalary(entries))
  })
})

describe('rateInputSchema', () => {
  it('принимает положительную целую ставку', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 500 }).success).toBe(true)
  })

  it('отклоняет ставку 0 (min(1) — 0 молча обнулил бы зарплату)', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 0 }).success).toBe(false)
  })

  it('отклоняет нецелый или неположительный masterId', () => {
    expect(rateInputSchema.safeParse({ masterId: 0, hourlyRate: 500 }).success).toBe(false)
    expect(rateInputSchema.safeParse({ masterId: 1.5, hourlyRate: 500 }).success).toBe(false)
  })

  it('отклоняет дробную ставку', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 500.5 }).success).toBe(false)
  })
})

describe('workHoursInputSchema', () => {
  const base = { masterId: 1, workDate: '2026-07-15' }

  it('принимает значение с шагом в четверть часа и необязательной заметкой', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 7.5, note: 'смена' }).success).toBe(
      true,
    )
    expect(workHoursInputSchema.safeParse({ ...base, hours: 0.25 }).success).toBe(true)
  })

  it('отклоняет часы не по сетке 0.25', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 7.1 }).success).toBe(false)
  })

  it('отклоняет неположительные часы или больше 24', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 0 }).success).toBe(false)
    expect(workHoursInputSchema.safeParse({ ...base, hours: 24.25 }).success).toBe(false)
  })

  it('отклоняет кривую или невозможную ISO-дату', () => {
    expect(
      workHoursInputSchema.safeParse({ masterId: 1, workDate: '15.07.2026', hours: 8 }).success,
    ).toBe(false)
    expect(
      workHoursInputSchema.safeParse({ masterId: 1, workDate: '2026-02-31', hours: 8 }).success,
    ).toBe(false)
    expect(
      workHoursInputSchema.safeParse({ masterId: 1, workDate: '2026-13-01', hours: 8 }).success,
    ).toBe(false)
  })
})

describe('workHoursUpdateSchema', () => {
  it('принимает частичный patch (все поля необязательны)', () => {
    expect(workHoursUpdateSchema.safeParse({}).success).toBe(true)
    expect(workHoursUpdateSchema.safeParse({ hours: 6 }).success).toBe(true)
    expect(workHoursUpdateSchema.safeParse({ note: 'fix' }).success).toBe(true)
  })

  it('не содержит masterId — лишний masterId игнорируется, а не принимается как поле', () => {
    const r = workHoursUpdateSchema.safeParse({ masterId: 9, hours: 6 })
    assert(r.success)
    expect('masterId' in r.data).toBe(false)
  })
})

describe('monthSchema', () => {
  it('принимает валидный YYYY-MM', () => {
    expect(monthSchema.safeParse('2026-07').success).toBe(true)
    expect(monthSchema.safeParse('2026-12').success).toBe(true)
    expect(monthSchema.safeParse('2026-01').success).toBe(true)
  })

  it('отклоняет месяц 00, 13 или кривую форму', () => {
    expect(monthSchema.safeParse('2026-00').success).toBe(false)
    expect(monthSchema.safeParse('2026-13').success).toBe(false)
    expect(monthSchema.safeParse('2026-7').success).toBe(false)
    expect(monthSchema.safeParse('26-07').success).toBe(false)
  })
})

describe('monthRange', () => {
  it('возвращает полуоткрытый диапазон в пределах одного года', () => {
    expect(monthRange('2026-07')).toEqual({ start: '2026-07-01', end: '2026-08-01' })
  })

  it('перекатывает декабрь в январь следующего года', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })
})

describe('payoutInputSchema', () => {
  const base = { masterId: 1, payoutDate: '2026-07-15' }

  it('принимает положительную и отрицательную целую сумму', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 5000 }).success).toBe(true)
    expect(payoutInputSchema.safeParse({ ...base, amount: -2000, note: 'штраф' }).success).toBe(
      true,
    )
  })

  it('отклоняет нулевую сумму с доменным сообщением', () => {
    const r = payoutInputSchema.safeParse({ ...base, amount: 0 })
    assert(!r.success)
    expect(r.error.issues[0]!.message).toBe('Сумма не может быть нулевой')
  })

  it('отклоняет дробную сумму (деньги — целые рубли)', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false)
  })

  it('отклоняет сумму за пределом ±10 000 000', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 10_000_001 }).success).toBe(false)
    expect(payoutInputSchema.safeParse({ ...base, amount: -10_000_001 }).success).toBe(false)
  })

  it('отклоняет кривую или невозможную ISO-дату', () => {
    expect(
      payoutInputSchema.safeParse({ masterId: 1, payoutDate: '2026-02-31', amount: 100 }).success,
    ).toBe(false)
    expect(
      payoutInputSchema.safeParse({ masterId: 1, payoutDate: '15.07.2026', amount: 100 }).success,
    ).toBe(false)
  })
})

describe('payoutUpdateSchema', () => {
  it('принимает частичный patch (все поля необязательны)', () => {
    expect(payoutUpdateSchema.safeParse({}).success).toBe(true)
    expect(payoutUpdateSchema.safeParse({ amount: -500 }).success).toBe(true)
    expect(payoutUpdateSchema.safeParse({ note: 'fix' }).success).toBe(true)
  })

  it('по-прежнему отклоняет нулевую сумму, если поле передано', () => {
    expect(payoutUpdateSchema.safeParse({ amount: 0 }).success).toBe(false)
  })

  it('не содержит masterId — мастер при правке не меняется', () => {
    const r = payoutUpdateSchema.safeParse({ masterId: 9, amount: 100 })
    assert(r.success)
    expect('masterId' in r.data).toBe(false)
  })
})

describe('mergeSalaryEntries', () => {
  const hours = (id: number, workDate: string): WorkHours => ({
    id,
    masterId: 1,
    workDate,
    minutes: 480,
    rateSnapshot: 100,
    note: '',
    createdAt: '2026-07-01T00:00:00.000Z',
  })
  const payout = (id: number, payoutDate: string): Payout => ({
    id,
    masterId: 1,
    payoutDate,
    amount: 1000,
    note: '',
    createdAt: '2026-07-01T00:00:00.000Z',
  })

  it('возвращает пустую ленту на пустой ввод', () => {
    expect(mergeSalaryEntries([], [])).toEqual([])
  })

  it('сортирует по возрастанию даты по обоим видам', () => {
    const feed = mergeSalaryEntries([hours(1, '2026-07-20')], [payout(2, '2026-07-05')])
    expect(feed.map(salaryEntryDate)).toEqual(['2026-07-05', '2026-07-20'])
    expect(feed.map((e) => e.kind)).toEqual(['payout', 'hours'])
  })

  it('ставит часы перед выплатами в один и тот же день', () => {
    const feed = mergeSalaryEntries([hours(7, '2026-07-10')], [payout(3, '2026-07-10')])
    expect(feed.map((e) => e.kind)).toEqual(['hours', 'payout'])
  })

  it('при равенстве дня и вида упорядочивает по id', () => {
    const feed = mergeSalaryEntries([hours(9, '2026-07-10'), hours(2, '2026-07-10')], [])
    expect(feed.map((e) => e.id)).toEqual([2, 9])
  })

  it('помечает каждый элемент его видом и сохраняет исходные имена полей', () => {
    const feed = mergeSalaryEntries([hours(1, '2026-07-01')], [payout(1, '2026-07-02')])
    const [first, second] = feed
    expect(first!.kind === 'hours' && first.workDate).toBe('2026-07-01')
    expect(second!.kind === 'payout' && second.payoutDate).toBe('2026-07-02')
  })
})

describe('selfEditWindow / isInSelfEditWindow', () => {
  it('охватывает последние SELF_EDIT_WINDOW_DAYS дней, включая сегодня', () => {
    expect(SELF_EDIT_WINDOW_DAYS).toBe(7)
    expect(selfEditWindow('2026-10-26')).toEqual({ from: '2026-10-20', to: '2026-10-26' })
  })

  it('переходит через границы месяца и года', () => {
    expect(selfEditWindow('2026-03-02').from).toBe('2026-02-24')
    expect(selfEditWindow('2027-01-03').from).toBe('2026-12-28')
  })

  it('принимает обе границы и отклоняет день до окна и будущее', () => {
    expect(isInSelfEditWindow('2026-10-20', '2026-10-26')).toBe(true)
    expect(isInSelfEditWindow('2026-10-26', '2026-10-26')).toBe(true)
    expect(isInSelfEditWindow('2026-10-19', '2026-10-26')).toBe(false)
    expect(isInSelfEditWindow('2026-10-27', '2026-10-26')).toBe(false)
  })
})
