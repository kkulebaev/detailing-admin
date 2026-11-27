import { describe, expect, it, vi } from 'vitest'
import { calToDdmmyyyy } from '@/lib/date'
import { useBookingDates } from '@/composables/use-booking-dates'

describe('useBookingDates', () => {
  it('чип дня ставит дату и сбрасывает диапазон', () => {
    const setField = vi.fn()
    const d = useBookingDates(setField)
    d.toggleRangeMode()
    expect(d.isRangeMode.value).toBe(true)
    expect(d.activeDayOffset.value).toBeNull()

    d.pickDay(1)
    const tomorrow = calToDdmmyyyy(d.todayVal.add({ days: 1 }))
    expect(d.isRangeMode.value).toBe(false)
    expect(d.dateFromText.value).toBe(tomorrow)
    expect(d.activeDayOffset.value).toBe(1)
    expect(setField).toHaveBeenCalledWith('dateFrom', tomorrow)
    expect(setField).toHaveBeenCalledWith('dateTo', undefined)
    expect(setField).toHaveBeenCalledWith('timeTo', undefined)
  })

  it('включение диапазона копирует начало в конец', () => {
    const setField = vi.fn()
    const d = useBookingDates(setField)
    d.pickDay(2)
    d.toggleRangeMode()
    expect(d.dateToText.value).toBe(d.dateFromText.value)
    expect(setField).toHaveBeenLastCalledWith('dateTo', d.dateFromText.value)
  })

  it('ручной ввод даты маскирует текст и двигает календарь', () => {
    const setField = vi.fn()
    const d = useBookingDates(setField)
    const el = document.createElement('input')
    document.body.append(el)
    // Через месяц от сегодня, чтобы ни один чип дня не совпал с датой.
    const later = d.todayVal.add({ days: 30 })
    const text = calToDdmmyyyy(later)
    el.addEventListener('input', d.onDateFromTextInput)
    el.value = text.replaceAll('.', '')
    el.dispatchEvent(new Event('input'))
    expect(el.value).toBe(text)
    expect(d.dateFromText.value).toBe(text)
    expect(d.dateFromCal.value.toString()).toBe(later.toString())
    expect(d.activeDayOffset.value).toBeNull()
    el.remove()
  })
})
