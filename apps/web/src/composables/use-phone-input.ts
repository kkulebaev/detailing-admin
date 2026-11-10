import { ref } from 'vue'
import { toast } from 'vue-sonner'

export const PHONE_PREFIX = '+7 ('

// Минимальная часть HTMLInputElement, которую трогает обработчик ввода.
// Утиная проверка принимает и настоящие DOM-поля, и моки из тестов.
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
  // отбрасываем ведущие 7 или 8 — они поглощаются префиксом +7
  let base = digits
  if (base.startsWith('7') || base.startsWith('8')) base = base.slice(1)
  const d = base.slice(0, 10)
  if (d.length === 0) {
    // Backspace через префикс должен очищать поле, а не разворачивать его заново.
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

// Считает значащие цифры (всё после поглощённого ведущего префикса 7/8),
// стоящие левее `pos` в сыром вводе. Нужно для восстановления каретки, чтобы
// правка в середине не отбрасывала её в конец строки после переформатирования.
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

// Переводит «каретка после N значащих цифр» в абсолютную позицию в
// отформатированной строке. Раскладка маски:
//   '+7 (DDD) DDD-DD-DD'  позиции 4-6, 9-11, 13-14, 16-17.
function caretPosForDigits(formatted: string, n: number): number {
  if (!formatted) return 0
  if (!formatted.startsWith(PHONE_PREFIX)) return formatted.length
  if (n === 0) return PHONE_PREFIX.length
  const pos = n <= 3 ? 4 + n : n <= 6 ? 6 + n : n <= 8 ? 7 + n : 8 + n
  return Math.min(pos, formatted.length)
}

// Вставленные строки могут содержать код страны, разделители или вообще не иметь префикса.
// Сводим к 10 значащим цифрам, прежде чем переиспользовать formatPhone, — ввод с клавиатуры
// идёт другим путём, где нельзя безопасно отрезать «ведущую 7/8» дважды.
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

  // Возвращает значение телефона для отправки:
  //   '', если пользователь не ввёл ни одной реальной цифры после префикса,
  //   иначе — сырую строку с маской (серверный transform нормализует её до E.164).
  function effectivePhone(): string {
    const digits = phoneRaw.value.replace(/\D/g, '')
    return digits.length <= 1 ? '' : phoneRaw.value
  }

  function onPhoneInput(e: Event) {
    // Проверяем target по утиной типизации вместо `instanceof HTMLInputElement`, чтобы
    // моки vitest без jsdom (простой объект с `value` + `setSelectionRange`)
    // тоже проходили; настоящие DOM-поля удовлетворяют тому же предикату.
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

  // Backspace или Delete в поле телефона, где есть только
  // автоматически подставленный префикс, должны сразу его стирать, где бы ни
  // стояла каретка, — иначе Delete в конце строки ничего бы не делал
  // (справа нет символа) и пользователь застрял бы с '+7 ('.
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
