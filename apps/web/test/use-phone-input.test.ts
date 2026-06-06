import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { usePhoneInput, PHONE_PREFIX } from '@/composables/use-phone-input'
import { toast } from 'vue-sonner'

function makeInputEvent(value: string): Event {
  const target = {
    value,
    setSelectionRange: vi.fn(),
  }
  return { target } as unknown as Event
}

function makePasteEvent(text: string): ClipboardEvent {
  return {
    clipboardData: { getData: () => text },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent
}

describe('usePhoneInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('начальное состояние', () => {
    it('phoneRaw пустой', () => {
      const { phoneRaw } = usePhoneInput()
      expect(phoneRaw.value).toBe('')
    })

    it('effectivePhone возвращает пустую строку', () => {
      const { effectivePhone } = usePhoneInput()
      expect(effectivePhone()).toBe('')
    })
  })

  describe('ввод через onPhoneInput', () => {
    it('первая цифра 9 раскрывается в +7 (9', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9'))
      expect(phoneRaw.value).toBe('+7 (9')
    })

    it('одиночная 7 раскрывается в префикс', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('7'))
      expect(phoneRaw.value).toBe(PHONE_PREFIX)
    })

    it('одиночная 8 раскрывается в префикс', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('8'))
      expect(phoneRaw.value).toBe(PHONE_PREFIX)
    })

    it('одиночный + остаётся +', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('+'))
      expect(phoneRaw.value).toBe('+')
    })

    it('пустой ввод даёт пустую строку', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent(''))
      expect(phoneRaw.value).toBe('')
    })

    it('последовательный посимвольный набор формирует полный номер', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      for (const ch of '9123456789') {
        onPhoneInput(makeInputEvent(phoneRaw.value + ch))
      }
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
    })

    it('ввод длиннее 10 значащих цифр обрезается', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('912345678999'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
    })

    it('+ перед цифрами раскрывается корректно', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('+'))
      onPhoneInput(makeInputEvent('+7'))
      expect(phoneRaw.value).toBe(PHONE_PREFIX)
      onPhoneInput(makeInputEvent('+79'))
      expect(phoneRaw.value).toBe('+7 (9')
    })
  })

  describe('стирание через onPhoneInput', () => {
    it('backspace в +7 (912 даёт +7 (91', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('912'))
      expect(phoneRaw.value).toBe('+7 (912')
      onPhoneInput(makeInputEvent('+7 (91'))
      expect(phoneRaw.value).toBe('+7 (91')
    })

    it('backspace через префикс +7 ( очищает поле полностью', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('7'))
      expect(phoneRaw.value).toBe(PHONE_PREFIX)
      onPhoneInput(makeInputEvent('+7 '))
      expect(phoneRaw.value).toBe('')
    })

    it('backspace из одиночного + очищает', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('+'))
      expect(phoneRaw.value).toBe('+')
      onPhoneInput(makeInputEvent(''))
      expect(phoneRaw.value).toBe('')
    })

    it('Cmd+A Delete очищает полностью набранный номер', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      onPhoneInput(makeInputEvent(''))
      expect(phoneRaw.value).toBe('')
    })
  })

  describe('onPhonePaste', () => {
    it.each([
      ['+7 (912) 345-67-89', '+7 (912) 345-67-89'],
      ['+7 912 345 67 89', '+7 (912) 345-67-89'],
      ['89123456789', '+7 (912) 345-67-89'],
      ['79123456789', '+7 (912) 345-67-89'],
      ['9123456789', '+7 (912) 345-67-89'],
      ['абв 9123456789 xyz', '+7 (912) 345-67-89'],
      ['8 (912) 345-67-89', '+7 (912) 345-67-89'],
    ])('форматирует %j в %j', (input, expected) => {
      const { phoneRaw, onPhonePaste } = usePhoneInput()
      onPhonePaste(makePasteEvent(input))
      expect(phoneRaw.value).toBe(expected)
    })

    it('пустой буфер не меняет phoneRaw и не вызывает preventDefault', () => {
      const { phoneRaw, onPhonePaste } = usePhoneInput()
      phoneRaw.value = '+7 (912'
      const evt = makePasteEvent('')
      onPhonePaste(evt)
      expect(phoneRaw.value).toBe('+7 (912')
      expect(evt.preventDefault).not.toHaveBeenCalled()
    })

    it('непустой ввод вызывает preventDefault', () => {
      const { onPhonePaste } = usePhoneInput()
      const evt = makePasteEvent('9123456789')
      onPhonePaste(evt)
      expect(evt.preventDefault).toHaveBeenCalled()
    })

    it('11 цифр без 7/8 в начале берёт последние 10', () => {
      const { phoneRaw, onPhonePaste } = usePhoneInput()
      onPhonePaste(makePasteEvent('19123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
    })
  })

  describe('onClickPastePhone', () => {
    it('вставляет нормализованный номер из буфера обмена', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { readText: vi.fn().mockResolvedValue('+7 912 345-67-89') },
      })
      const { phoneRaw, onClickPastePhone } = usePhoneInput()
      await onClickPastePhone()
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
    })

    it('показывает toast при пустом буфере', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { readText: vi.fn().mockResolvedValue('   ') },
      })
      const { phoneRaw, onClickPastePhone } = usePhoneInput()
      await onClickPastePhone()
      expect(phoneRaw.value).toBe('')
      expect(toast.error).toHaveBeenCalledWith('Буфер обмена пуст')
    })

    it('показывает toast при отказе доступа к буферу', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
      })
      const { onClickPastePhone } = usePhoneInput()
      await onClickPastePhone()
      expect(toast.error).toHaveBeenCalledWith('Не удалось прочитать буфер обмена')
    })
  })

  describe('effectivePhone', () => {
    it('пустая строка', () => {
      const { effectivePhone } = usePhoneInput()
      expect(effectivePhone()).toBe('')
    })

    it('одиночный + считается пустым', () => {
      const { phoneRaw, effectivePhone } = usePhoneInput()
      phoneRaw.value = '+'
      expect(effectivePhone()).toBe('')
    })

    it('только префикс считается пустым', () => {
      const { phoneRaw, effectivePhone } = usePhoneInput()
      phoneRaw.value = PHONE_PREFIX
      expect(effectivePhone()).toBe('')
    })

    it('полный номер возвращается как есть', () => {
      const { phoneRaw, effectivePhone } = usePhoneInput()
      phoneRaw.value = '+7 (912) 345-67-89'
      expect(effectivePhone()).toBe('+7 (912) 345-67-89')
    })

    it('частично набранный номер возвращается как есть', () => {
      const { phoneRaw, effectivePhone } = usePhoneInput()
      phoneRaw.value = '+7 (912'
      expect(effectivePhone()).toBe('+7 (912')
    })
  })

  describe('resetPhone', () => {
    it('обнуляет phoneRaw', () => {
      const { phoneRaw, resetPhone } = usePhoneInput()
      phoneRaw.value = '+7 (912) 345-67-89'
      resetPhone()
      expect(phoneRaw.value).toBe('')
    })
  })
})
