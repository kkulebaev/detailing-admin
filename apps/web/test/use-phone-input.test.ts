import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { usePhoneInput, PHONE_PREFIX } from '@/composables/use-phone-input'
import { toast } from 'vue-sonner'

function makeInputEvent(value: string, selectionStart?: number): Event {
  const target = {
    value,
    selectionStart,
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

  describe('позиция каретки после переформатирования', () => {
    function getCaret(event: Event): number | null {
      const target = (event as unknown as { target: { setSelectionRange: ReturnType<typeof vi.fn> } }).target
      const call = target.setSelectionRange.mock.calls.at(-1)
      return call ? (call[0] as number) : null
    }

    it('Delete в середине оставляет каретку на той же значимой цифре', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      // Каретка после "1" в "+7 (91|2) 345-67-89" — это позиция 6.
      // Delete удаляет "2" → "+7 (91) 345-67-89", каретка остаётся на 6.
      const evt = makeInputEvent('+7 (91) 345-67-89', 6)
      onPhoneInput(evt)
      expect(getCaret(evt)).toBe(6)
    })

    it('Backspace в середине ставит каретку перед позицией удалённой цифры', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      // Каретка между "1" и "2" — позиция 6. Backspace удаляет "1" → каретка 5.
      const evt = makeInputEvent('+7 (92) 345-67-89', 5)
      onPhoneInput(evt)
      expect(getCaret(evt)).toBe(5)
    })

    it('Delete между группами сохраняет каретку перед следующей группой', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      // Каретка после "3" в "+7 (912) 3|45-67-89" — позиция 10.
      // Delete удаляет "4" → "+7 (912) 35-67-89", каретка остаётся 10.
      const evt = makeInputEvent('+7 (912) 35-67-89', 10)
      onPhoneInput(evt)
      expect(getCaret(evt)).toBe(10)
    })

    it('Backspace перед "(" перепрыгивает через закрытие группы', () => {
      const { phoneRaw, onPhoneInput } = usePhoneInput()
      onPhoneInput(makeInputEvent('9123456789'))
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      // Каретка после "3" группы 2 ("+7 (912) 3|45-67-89") — позиция 10.
      // Backspace удаляет "3" → каретка 9, после ") "
      const evt = makeInputEvent('+7 (912) 45-67-89', 9)
      onPhoneInput(evt)
      // После переформата "+7 (912) 456-78-9", n=3 → каретка 7
      expect(getCaret(evt)).toBe(7)
    })

    it('ввод символа в конце оставляет каретку в конце', () => {
      const { onPhoneInput } = usePhoneInput()
      const evt = makeInputEvent('9')
      onPhoneInput(evt)
      // formatted = "+7 (9", caretBefore = undefined → значит конец target.value (1),
      // sigDigits = 1, caretPos = 5 (длина formatted), setSelectionRange(5, 5)
      expect(getCaret(evt)).toBe(5)
    })
  })

  describe('onPhoneKeydown', () => {
    function makeKeyEvent(key: string): KeyboardEvent {
      return {
        key,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent
    }

    it('Backspace на префиксе очищает поле и вызывает preventDefault', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = PHONE_PREFIX
      const evt = makeKeyEvent('Backspace')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('')
      expect(evt.preventDefault).toHaveBeenCalled()
    })

    it('Delete на префиксе очищает поле независимо от позиции каретки', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = PHONE_PREFIX
      const evt = makeKeyEvent('Delete')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('')
      expect(evt.preventDefault).toHaveBeenCalled()
    })

    it('Delete на одиночном + очищает', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = '+'
      const evt = makeKeyEvent('Delete')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('')
      expect(evt.preventDefault).toHaveBeenCalled()
    })

    it('Backspace на одиночном + очищает', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = '+'
      const evt = makeKeyEvent('Backspace')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('')
      expect(evt.preventDefault).toHaveBeenCalled()
    })

    it('Delete на полном номере не трогает phoneRaw и не вызывает preventDefault', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = '+7 (912) 345-67-89'
      const evt = makeKeyEvent('Delete')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('+7 (912) 345-67-89')
      expect(evt.preventDefault).not.toHaveBeenCalled()
    })

    it('Backspace на пустом поле ничего не делает', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      const evt = makeKeyEvent('Backspace')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe('')
      expect(evt.preventDefault).not.toHaveBeenCalled()
    })

    it('другие клавиши игнорируются даже на префиксе', () => {
      const { phoneRaw, onPhoneKeydown } = usePhoneInput()
      phoneRaw.value = PHONE_PREFIX
      const evt = makeKeyEvent('a')
      onPhoneKeydown(evt)
      expect(phoneRaw.value).toBe(PHONE_PREFIX)
      expect(evt.preventDefault).not.toHaveBeenCalled()
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
