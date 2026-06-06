import { ref } from 'vue'
import { toast } from 'vue-sonner'

export const PHONE_PREFIX = '+7 ('

// Minimal surface of HTMLInputElement that the input handler touches. The
// duck-typed predicate accepts both real DOM inputs and the test mocks.
interface InputLike {
  value: string
  selectionStart: number | null
  setSelectionRange(start: number, end: number): void
}
function isInputLike(target: unknown): target is InputLike {
  return (
    target !== null &&
    typeof target === 'object' &&
    'value' in target &&
    typeof target.value === 'string' &&
    'setSelectionRange' in target &&
    typeof target.setSelectionRange === 'function'
  )
}

function formatPhone(input: string, isDeleting = false): string {
  const digits = input.replace(/\D/g, '')
  // strip leading 7 or 8 — they're absorbed into the +7 prefix
  let base = digits
  if (base.startsWith('7') || base.startsWith('8')) base = base.slice(1)
  const d = base.slice(0, 10)
  if (d.length === 0) {
    // Backspace through the prefix should clear the field, not re-expand it.
    if (isDeleting) return ''
    if (digits === '7' || digits === '8') return PHONE_PREFIX
    if (input.includes('+')) return '+'
    return ''
  }
  if (d.length <= 3) return `+7 (${d}`
  if (d.length <= 6) return `+7 (${d.slice(0, 3)}) ${d.slice(3)}`
  if (d.length <= 8) return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`
}

// Count significant digits (everything after the absorbed leading 7/8 prefix)
// that sit to the left of `pos` in the raw input. Drives caret restoration so
// editing in the middle doesn't jump to end-of-string after reformatting.
function countSignificantDigits(input: string, pos: number): number {
  const slice = input.slice(0, Math.max(0, Math.min(pos, input.length)))
  const before = slice.replace(/\D/g, '')
  if (before.length === 0) return 0
  const all = input.replace(/\D/g, '')
  if ((all.startsWith('7') || all.startsWith('8')) && before[0] === all[0]) {
    return before.length - 1
  }
  return before.length
}

// Map "caret after N significant digits" to the absolute position in the
// formatted string. Mask layout:
//   '+7 (DDD) DDD-DD-DD'  positions 4-6, 9-11, 13-14, 16-17.
function caretPosForDigits(formatted: string, n: number): number {
  if (!formatted) return 0
  if (!formatted.startsWith(PHONE_PREFIX)) return formatted.length
  if (n === 0) return PHONE_PREFIX.length
  const pos
    = n <= 3 ? 4 + n
      : n <= 6 ? 6 + n
        : n <= 8 ? 7 + n
          : 8 + n
  return Math.min(pos, formatted.length)
}

// Pasted strings may carry a country code, separators, or no prefix at all.
// Reduce to the 10 significant digits before reusing formatPhone — typing
// goes through a different path that can't safely strip a "leading 7/8" twice.
export function formatPastedPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  let ten = digits
  if (ten.length === 11 && (ten.startsWith('7') || ten.startsWith('8'))) {
    ten = ten.slice(1)
  } else if (ten.length > 10) {
    ten = ten.slice(-10)
  }
  return formatPhone(ten)
}

export function usePhoneInput() {
  const phoneRaw = ref('')

  // Returns the phone value to send on submit:
  //   '' when the user hasn't typed any real digits past the prefix,
  //   the raw masked string otherwise (server transform normalises to E.164).
  function effectivePhone(): string {
    const digits = phoneRaw.value.replace(/\D/g, '')
    return digits.length <= 1 ? '' : phoneRaw.value
  }

  function onPhoneInput(e: Event) {
    // Duck-type the target instead of `instanceof HTMLInputElement` so the
    // jsdom-free vitest mocks (plain object with `value` + `setSelectionRange`)
    // still flow through; real DOM input elements satisfy the same predicate.
    const target = e.target
    if (!isInputLike(target)) return
    const isDeleting = target.value.length < phoneRaw.value.length
    const caretBefore = target.selectionStart ?? target.value.length
    const sigDigits = countSignificantDigits(target.value, caretBefore)
    const formatted = formatPhone(target.value, isDeleting)
    if (target.value !== formatted) {
      phoneRaw.value = formatted
      target.value = formatted
      const caret = caretPosForDigits(formatted, sigDigits)
      target.setSelectionRange(caret, caret)
    } else if (phoneRaw.value !== formatted) {
      phoneRaw.value = formatted
    }
  }

  // Pressing Backspace or Delete on a phone field that only holds the
  // auto-injected prefix should wipe it instantly, no matter where the
  // caret is — otherwise a Delete at end-of-string would do nothing
  // (no character to the right) and leave the user stuck with '+7 ('.
  function onPhoneKeydown(e: KeyboardEvent) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return
    if (phoneRaw.value === PHONE_PREFIX || phoneRaw.value === '+') {
      e.preventDefault()
      phoneRaw.value = ''
    }
  }

  function onPhonePaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!text) return
    e.preventDefault()
    phoneRaw.value = formatPastedPhone(text)
  }

  async function onClickPastePhone() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Буфер обмена пуст')
        return
      }
      phoneRaw.value = formatPastedPhone(text)
    } catch {
      toast.error('Не удалось прочитать буфер обмена')
    }
  }

  function resetPhone() {
    phoneRaw.value = ''
  }

  return {
    phoneRaw,
    effectivePhone,
    onPhoneInput,
    onPhoneKeydown,
    onPhonePaste,
    onClickPastePhone,
    resetPhone,
  }
}
