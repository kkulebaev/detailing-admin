import { describe, it, expect } from 'vitest'
import { splitCar } from '../scripts/backfill-client-cars-from-sheet.js'

describe('splitCar', () => {
  it('считает строку без запятой маркой/моделью с пустым номером (типичный случай)', () => {
    expect(splitCar('Skoda Octavia')).toEqual({ makeModel: 'Skoda Octavia', plate: '' })
  })

  it('отделяет номер после последнего ", "', () => {
    expect(splitCar('BMW X6, А123АА77')).toEqual({ makeModel: 'BMW X6', plate: 'А123АА77' })
  })

  it('делит по ПОСЛЕДНЕМУ разделителю, чтобы марка/модель с ", " осталась целой', () => {
    expect(splitCar('Mercedes, Benz C, О001ОО77')).toEqual({
      makeModel: 'Mercedes, Benz C',
      plate: 'О001ОО77',
    })
  })

  it('обрезает пробелы в обеих частях', () => {
    expect(splitCar('  Volvo XC60 ,  В777ВВ99 ')).toEqual({
      makeModel: 'Volvo XC60',
      plate: 'В777ВВ99',
    })
  })

  it('обрабатывает пустую строку', () => {
    expect(splitCar('')).toEqual({ makeModel: '', plate: '' })
  })
})
