import { describe, it, expect } from 'vitest'
import { csvField, toCsv } from '../src/csv.js'

describe('csvField — обезвреживание инъекций (OWASP)', () => {
  it('добавляет одинарную кавычку перед ячейкой-формулой (=)', () => {
    expect(csvField('=cmd|calc', ';')).toBe("'=cmd|calc")
  })

  it('добавляет префикс к телефону E.164 (+), чтобы он не читался как формула/число', () => {
    expect(csvField('+79991234567', ';')).toBe("'+79991234567")
  })

  it('добавляет префикс к ведущим @ и -', () => {
    expect(csvField('@SUM(A1)', ';')).toBe("'@SUM(A1)")
    expect(csvField('-1+1', ';')).toBe("'-1+1")
  })

  it('добавляет префикс к ведущему TAB', () => {
    expect(csvField('\tinjected', ';')).toBe("'\tinjected")
  })

  it('добавляет префикс к ведущему CR (и затем берет в кавычки, так как CR требует кавычек)', () => {
    // Ведущий символ `\r` → добавляется префикс `'`; в результате все еще есть CR, поэтому
    // правило RFC оборачивает его в кавычки.
    expect(csvField('\rinjected', ';')).toBe('"\'\rinjected"')
  })
})

describe('csvField — кавычки по RFC 4180', () => {
  it('оборачивает поле с разделителем', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"')
  })

  it('удваивает внутренние кавычки и оборачивает', () => {
    expect(csvField('a"b', ';')).toBe('"a""b"')
  })

  it('оборачивает поле с переводом строки', () => {
    expect(csvField('line1\nline2', ';')).toBe('"line1\nline2"')
  })

  it('не трогает обычное поле', () => {
    expect(csvField('Иван Содель', ';')).toBe('Иван Содель')
  })

  it('учитывает разделитель-запятую при решении о кавычках', () => {
    expect(csvField('a,b', ',')).toBe('"a,b"')
    expect(csvField('a;b', ',')).toBe('a;b')
  })
})

describe('toCsv', () => {
  it('добавляет BOM в начало, склеивает ячейки разделителем, а строки — CRLF', () => {
    const csv = toCsv([
      ['Имя', 'Телефон'],
      ['Иван', '+79991234567'],
    ])
    expect(csv).toBe("﻿Имя;Телефон\r\nИван;'+79991234567")
  })

  it('не добавляет BOM при bom:false', () => {
    expect(toCsv([['a', 'b']], { bom: false })).toBe('a;b')
  })

  it('использует заданный разделитель', () => {
    expect(toCsv([['a', 'b']], { bom: false, delimiter: ',' })).toBe('a,b')
  })

  it('сохраняет порядок колонок во всех строках', () => {
    const csv = toCsv(
      [
        ['c1', 'c2', 'c3'],
        ['1', '2', '3'],
      ],
      { bom: false },
    )
    expect(csv).toBe('c1;c2;c3\r\n1;2;3')
  })
})
