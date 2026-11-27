// Маски текстовых полей форм записи. Поля печатают посимвольно, поэтому маски
// терпят неполный ввод и никогда не отказывают: строгая проверка — дело схемы при отправке.

export function maskDateText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`
}

export function maskTimeText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

function capitalizeWords(raw: string): string {
  return raw.replace(
    /(^|[\s\-])(\p{L})/gu,
    (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru'),
  )
}

export function maskName(raw: string): string {
  return capitalizeWords(raw.replace(/\d/g, ''))
}

export function maskCar(raw: string): string {
  return capitalizeWords(raw)
}

export function amountDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

// Gboard держит набираемое слово в композиции до пробела/коммита, и правка
// value/каретки в этот момент сбивает сессию ввода: символы теряются, курсор
// прыгает. Пока композиция активна, маска не применяется — в форму уходит сырой
// текст, а закрывающий `input` (он приходит уже без флага) домаскирует его.
export function isComposingInput(e: Event): boolean {
  return e instanceof InputEvent && e.isComposing
}

// Пишет в DOM только при отличии: лишняя запись value сбрасывает каретку даже
// тогда, когда маска ничего не поменяла.
export function writeMasked(
  target: HTMLInputElement,
  value: string,
  caret: number = value.length,
): boolean {
  if (target.value === value) return false
  target.value = value
  target.setSelectionRange(caret, caret)
  return true
}
