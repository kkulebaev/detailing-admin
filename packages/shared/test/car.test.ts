import { describe, it, expect } from 'vitest'
import { joinCar, normalizeCarKey } from '../src/car.js'

describe('joinCar', () => {
  it('with plate → "Марка, НОМЕР"', () => {
    expect(joinCar('Toyota Camry', 'А123АА77')).toBe('Toyota Camry, А123АА77')
  })

  it('empty plate → bare car without trailing ", "', () => {
    expect(joinCar('Toyota Camry', '')).toBe('Toyota Camry')
  })

  it('undefined plate → bare car without trailing ", "', () => {
    expect(joinCar('Toyota Camry')).toBe('Toyota Camry')
  })

  it('empty car with plate → bare plate (filter drops empties)', () => {
    expect(joinCar('', 'А123АА77')).toBe('А123АА77')
  })
})

describe('normalizeCarKey', () => {
  it('make/model: trims and collapses internal whitespace', () => {
    expect(normalizeCarKey('  Toyota   Camry  ')).toBe('Toyota Camry')
  })

  it('make/model: preserves case', () => {
    expect(normalizeCarKey('toyota camry')).toBe('toyota camry')
  })

  it('plate: upper-cases and removes all spaces', () => {
    expect(normalizeCarKey('а 123 аа 77', true)).toBe('А123АА77')
  })

  it('plate: already normalized stays stable', () => {
    expect(normalizeCarKey('А123АА77', true)).toBe('А123АА77')
  })
})
