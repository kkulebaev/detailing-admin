// Маска разделителя тысяч с сохранением каретки для числовых текстовых полей.
//
// Повторное наложение маски с пробелами-разделителями обычно отбрасывает каретку в
// конец строки, так что удаление или вставка цифры в середине числа заставляет её
// прыгать. `maskThousands` заново вычисляет позицию каретки по числу цифр
// слева от неё, удерживая её на той же границе между цифрами при переформатировании.

function groupThousands(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export interface MaskedNumber {
  value: string
  caret: number
}

export function maskThousands(
  rawValue: string,
  caretPos: number,
  maxDigits = Number.POSITIVE_INFINITY,
): MaskedNumber {
  const digitsBeforeCaret = rawValue.slice(0, Math.max(0, caretPos)).replace(/\D/g, '').length
  const digits = rawValue.replace(/\D/g, '').slice(0, maxDigits)
  const value = groupThousands(digits)

  // Ставим каретку сразу после того же числа цифр, за которым она стояла раньше.
  const anchor = Math.min(digitsBeforeCaret, digits.length)
  if (anchor === 0) return { value, caret: 0 }
  let seen = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 48 && code <= 57) {
      seen += 1
      if (seen === anchor) return { value, caret: i + 1 }
    }
  }
  return { value, caret: value.length }
}
