import { describe, it, expect } from 'vitest'
import { joinCar, normalizeCarKey } from '../src/car.js'

describe('joinCar', () => {
  it('с номером → "Марка, НОМЕР"', () => {
    expect(joinCar('Toyota Camry', 'А123АА77')).toBe('Toyota Camry, А123АА77')
  })

  it('пустой номер → голая машина без хвостового ", "', () => {
    expect(joinCar('Toyota Camry', '')).toBe('Toyota Camry')
  })

  it('номер undefined → голая машина без хвостового ", "', () => {
    expect(joinCar('Toyota Camry')).toBe('Toyota Camry')
  })

  it('пустая машина с номером → голый номер (filter выкидывает пустые)', () => {
    expect(joinCar('', 'А123АА77')).toBe('А123АА77')
  })
})

describe('normalizeCarKey', () => {
  it('марка/модель: обрезает края и схлопывает внутренние пробелы', () => {
    expect(normalizeCarKey('  Toyota   Camry  ')).toBe('Toyota Camry')
  })

  it('марка/модель: сохраняет регистр', () => {
    expect(normalizeCarKey('toyota camry')).toBe('toyota camry')
  })

  it('номер: переводит в верхний регистр и убирает все пробелы', () => {
    expect(normalizeCarKey('а 123 аа 77', true)).toBe('А123АА77')
  })

  it('номер: уже нормализованный не меняется', () => {
    expect(normalizeCarKey('А123АА77', true)).toBe('А123АА77')
  })
})
