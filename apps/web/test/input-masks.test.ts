import { describe, expect, it } from 'vitest'
import {
  amountDigits,
  maskCar,
  maskDateText,
  maskName,
  maskTimeText,
  writeMasked,
} from '@/lib/input-masks'

describe('maskDateText', () => {
  it('ставит точки по мере ввода и обрезает лишние цифры', () => {
    expect(maskDateText('0')).toBe('0')
    expect(maskDateText('0412')).toBe('04.12')
    expect(maskDateText('04122026999')).toBe('04.12.2026')
    expect(maskDateText('04/12/2026')).toBe('04.12.2026')
  })
})

describe('maskTimeText', () => {
  it('ставит двоеточие после часов', () => {
    expect(maskTimeText('10')).toBe('10')
    expect(maskTimeText('1030')).toBe('10:30')
    expect(maskTimeText('10:305')).toBe('10:30')
  })
})

describe('maskName / maskCar', () => {
  it('имя: убирает цифры и поднимает первые буквы слов, в том числе после дефиса', () => {
    expect(maskName('анна-мария 2 петрова')).toBe('Анна-Мария  Петрова')
  })
  it('машина: цифры оставляет', () => {
    expect(maskCar('bmw x5')).toBe('Bmw X5')
  })
})

describe('amountDigits', () => {
  it('оставляет только цифры', () => {
    expect(amountDigits('12 500 ₽')).toBe('12500')
  })
})

describe('writeMasked', () => {
  it('не трогает поле, если маска ничего не поменяла', () => {
    const el = document.createElement('input')
    el.value = '10:30'
    expect(writeMasked(el, '10:30')).toBe(false)
  })
  it('пишет значение и ставит каретку', () => {
    const el = document.createElement('input')
    document.body.append(el)
    el.value = '1030'
    expect(writeMasked(el, '10:30', 2)).toBe(true)
    expect(el.value).toBe('10:30')
    expect(el.selectionStart).toBe(2)
    el.remove()
  })
})
