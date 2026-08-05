import { describe, it, expect } from 'vitest'
import { splitCar } from '../scripts/backfill-client-cars-from-sheet.js'

describe('splitCar', () => {
  it('treats a comma-less string as make/model with an empty plate (the common case)', () => {
    expect(splitCar('Skoda Octavia')).toEqual({ makeModel: 'Skoda Octavia', plate: '' })
  })

  it('splits the plate off after the last ", "', () => {
    expect(splitCar('BMW X6, А123АА77')).toEqual({ makeModel: 'BMW X6', plate: 'А123АА77' })
  })

  it('splits on the LAST separator so a make/model containing ", " stays intact', () => {
    expect(splitCar('Mercedes, Benz C, О001ОО77')).toEqual({
      makeModel: 'Mercedes, Benz C',
      plate: 'О001ОО77',
    })
  })

  it('trims both halves', () => {
    expect(splitCar('  Volvo XC60 ,  В777ВВ99 ')).toEqual({ makeModel: 'Volvo XC60', plate: 'В777ВВ99' })
  })

  it('handles an empty string', () => {
    expect(splitCar('')).toEqual({ makeModel: '', plate: '' })
  })
})
