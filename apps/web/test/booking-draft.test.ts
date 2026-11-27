import { describe, expect, it } from 'vitest'
import { bookingDraftSchema, isMeaningfulBookingDraft } from '@/lib/booking-draft'

describe('isMeaningfulBookingDraft', () => {
  it('нетронутая форма — не черновик', () => {
    expect(
      isMeaningfulBookingDraft({
        dateFromText: '27.11.2026',
        phoneRaw: '+7',
        master: [],
        discountUnit: 'rub',
        carClass: 1,
      }),
    ).toBe(false)
  })

  it('любое введенное поле делает черновик содержательным', () => {
    expect(isMeaningfulBookingDraft({ name: 'Иван' })).toBe(true)
    expect(isMeaningfulBookingDraft({ master: ['Петр'] })).toBe(true)
    expect(isMeaningfulBookingDraft({ master: 'Петр' })).toBe(true)
    expect(isMeaningfulBookingDraft({ phoneRaw: '+7 9' })).toBe(true)
  })
})

describe('bookingDraftSchema', () => {
  it('принимает старый черновик с мастером-строкой', () => {
    expect(bookingDraftSchema.safeParse({ master: 'Петр' }).success).toBe(true)
  })
})
