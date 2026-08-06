import { describe, it, expect } from 'vitest'
import { csvField, toCsv } from '../src/csv.js'

describe('csvField — injection neutralization (OWASP)', () => {
  it('prefixes a formula cell (=) with a single quote', () => {
    expect(csvField('=cmd|calc', ';')).toBe("'=cmd|calc")
  })

  it('prefixes an E.164 phone (+) so it is not read as a formula/number', () => {
    expect(csvField('+79991234567', ';')).toBe("'+79991234567")
  })

  it('prefixes @ and - leaders', () => {
    expect(csvField('@SUM(A1)', ';')).toBe("'@SUM(A1)")
    expect(csvField('-1+1', ';')).toBe("'-1+1")
  })

  it('prefixes a leading TAB', () => {
    expect(csvField('\tinjected', ';')).toBe("'\tinjected")
  })

  it('prefixes a leading CR (and then quotes it, since CR forces quoting)', () => {
    // Leader is `\r` → prefixed with `'`; the result still contains a CR, so the
    // RFC rule wraps it in quotes.
    expect(csvField('\rinjected', ';')).toBe('"\'\rinjected"')
  })
})

describe('csvField — RFC 4180 quoting', () => {
  it('wraps a field containing the delimiter', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"')
  })

  it('doubles inner quotes and wraps', () => {
    expect(csvField('a"b', ';')).toBe('"a""b"')
  })

  it('wraps a field containing a newline', () => {
    expect(csvField('line1\nline2', ';')).toBe('"line1\nline2"')
  })

  it('leaves a plain field untouched', () => {
    expect(csvField('Иван Содель', ';')).toBe('Иван Содель')
  })

  it('honours a comma delimiter for quoting decisions', () => {
    expect(csvField('a,b', ',')).toBe('"a,b"')
    expect(csvField('a;b', ',')).toBe('a;b')
  })
})

describe('toCsv', () => {
  it('prepends a BOM, joins cells by delimiter and rows by CRLF', () => {
    const csv = toCsv([
      ['Имя', 'Телефон'],
      ['Иван', '+79991234567'],
    ])
    expect(csv).toBe('﻿Имя;Телефон\r\nИван;\'+79991234567')
  })

  it('omits the BOM when bom:false', () => {
    expect(toCsv([['a', 'b']], { bom: false })).toBe('a;b')
  })

  it('uses a custom delimiter', () => {
    expect(toCsv([['a', 'b']], { bom: false, delimiter: ',' })).toBe('a,b')
  })

  it('preserves column order across rows', () => {
    const csv = toCsv([['c1', 'c2', 'c3'], ['1', '2', '3']], { bom: false })
    expect(csv).toBe('c1;c2;c3\r\n1;2;3')
  })
})
