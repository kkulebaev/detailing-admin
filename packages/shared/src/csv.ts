// CSV-сериализация для выгрузки отчетов. Собрана здесь, чтобы роуты экспорта в API
// и их тесты делили одну реализацию двух вещей, в которых легко незаметно
// ошибиться:
//
//  1. CSV-инъекция (OWASP). Ячейка, первый символ которой `= + - @` (или ведущий
//     TAB/CR), исполняется Excel/LibreOffice как формула при открытии файла —
//     реальный вектор утечки данных/DDE. Телефон в E.164 (`+7…`) срабатывает
//     всегда. Такую ячейку обезвреживаем ведущей одинарной кавычкой — стандартная
//     мера OWASP; она отображается как безобидный текстовый префикс.
//  2. Кавычки по RFC 4180. Поле с разделителем, двойной кавычкой или переводом
//     строки оборачивается в двойные кавычки, а внутренние кавычки удваиваются.

const INJECTION_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

// U+FEFF. Ставится в начало, чтобы Excel распознал UTF-8 и кириллица не превратилась в кашу.
const BOM = '﻿'

export function csvField(value: string, delimiter: string): string {
  let field = value
  // Сначала защита от инъекций: после добавления `'` поле можно безопасно брать в кавычки
  // (`'` сам по себе никогда не требует кавычек), а значение, начинавшееся с голого CR,
  // все равно обернется по правилу RFC ниже.
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
  /** Разделитель полей. `;` (по умолчанию) — то, что ждет Excel в ru-локали. */
  delimiter?: string
  /** Добавить UTF-8 BOM в начало (по умолчанию true), чтобы Excel верно читал кириллицу. */
  bom?: boolean
}

export function toCsv(rows: string[][], opts: ToCsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ';'
  const bom = opts.bom ?? true
  // Окончания строк CRLF — удобное для Excel значение по умолчанию (RFC 4180).
  const body = rows
    .map((row) => row.map((cell) => csvField(cell, delimiter)).join(delimiter))
    .join('\r\n')
  return bom ? BOM + body : body
}
