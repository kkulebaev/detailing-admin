import { ref } from 'vue'
import { toast } from 'vue-sonner'

export const PHONE_PREFIX = '+7 ('

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

// Pasted strings may carry a country code, separators, or no prefix at all.
// Reduce to the 10 significant digits before reusing formatPhone — typing
// goes through a different path that can't safely strip a "leading 7/8" twice.
function formatPastedPhone(input: string): string {
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
    const target = e.target as HTMLInputElement
    const isDeleting = target.value.length < phoneRaw.value.length
    const formatted = formatPhone(target.value, isDeleting)
    if (target.value !== formatted) {
      phoneRaw.value = formatted
      target.value = formatted
      target.setSelectionRange(formatted.length, formatted.length)
    } else if (phoneRaw.value !== formatted) {
      phoneRaw.value = formatted
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
    onPhonePaste,
    onClickPastePhone,
    resetPhone,
  }
}
