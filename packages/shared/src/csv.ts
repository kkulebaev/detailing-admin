// CSV serialization for report exports. Centralized here so the API's export
// routes and their tests share one implementation of two concerns that are easy
// to get subtly wrong:
//
//  1. CSV injection (OWASP). A cell whose first character is `= + - @` (or a
//     leading TAB/CR) is executed as a formula by Excel/LibreOffice when the file
//     is opened — a real exfiltration/DDE vector. A phone in E.164 (`+7…`) is a
//     permanent trigger. We neutralize such a cell with a leading single quote,
//     the standard OWASP mitigation; it renders as an inert text prefix.
//  2. RFC 4180 quoting. A field containing the delimiter, a double-quote, or a
//     line break is wrapped in double-quotes with any inner quote doubled.

const INJECTION_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

// U+FEFF. Prefixed so Excel detects UTF-8 and Cyrillic doesn't garble.
const BOM = '﻿'

export function csvField(value: string, delimiter: string): string {
  let field = value
  // Injection guard first: prepending `'` is safe to quote afterwards (`'` is
  // never itself a quoting trigger), and a value that started with a bare CR
  // still gets wrapped by the RFC rule below.
  if (field.length > 0 && INJECTION_PREFIXES.has(field[0]!)) {
    field = `'${field}`
  }
  if (
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r')
  ) {
    field = `"${field.replace(/"/g, '""')}"`
  }
  return field
}

export interface ToCsvOptions {
  /** Field separator. `;` (the default) is what ru-locale Excel expects. */
  delimiter?: string
  /** Prepend a UTF-8 BOM (default true) so Excel reads Cyrillic correctly. */
  bom?: boolean
}

export function toCsv(rows: string[][], opts: ToCsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ';'
  const bom = opts.bom ?? true
  // CRLF row endings are the Excel-friendly default (RFC 4180).
  const body = rows
    .map((row) => row.map((cell) => csvField(cell, delimiter)).join(delimiter))
    .join('\r\n')
  return bom ? BOM + body : body
}
