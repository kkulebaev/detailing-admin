// Caret-preserving thousand-separator mask for numeric text inputs.
//
// Re-masking a value with grouping spaces normally snaps the caret to the end
// of the string, so deleting or inserting a digit mid-number makes the caret
// jump. `maskThousands` re-derives the caret from the count of digits to its
// left, keeping it anchored to the same digit boundary across the reformat.

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
  const digitsBeforeCaret = rawValue
    .slice(0, Math.max(0, caretPos))
    .replace(/\D/g, '').length
  const digits = rawValue.replace(/\D/g, '').slice(0, maxDigits)
  const value = groupThousands(digits)

  // Place the caret just after the same count of digits it followed before.
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
