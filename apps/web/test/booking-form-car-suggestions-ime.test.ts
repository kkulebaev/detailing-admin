// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { Client } from '@/lib/clients-api'

// Regression guard for the Android/Gboard bug in «Марка и модель»: Gboard keeps
// a word in composition until a space/commit, and Vue's v-model refuses to
// touch the DOM while `el.composing` is set. Picking a suggestion therefore
// updated the form state but left the field showing the typed prefix — and the
// next keystroke overwrote the pick. Reproduced only on Android, where an IME
// composition is active for plain latin typing too.

vi.mock('@/composables/use-client-lookup', async () => {
  const { ref: r } = await vi.importActual<typeof import('vue')>('vue')
  return { useClientLookup: () => ({ matchedClient: r<Client | null>(null) }) }
})

vi.mock('@/lib/queries', () => ({
  useMastersQuery: () => ({ data: ref({ ok: true, masters: [] }), asyncStatus: ref('idle') }),
  usePricelistQuery: () => ({ data: ref({ ok: true, sections: [] }) }),
}))

vi.mock('@/lib/api', () => ({ submitBooking: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import BookingForm from '@/components/BookingForm.vue'

function mountForm() {
  return mount(BookingForm, {
    attachTo: document.body,
    global: { stubs: { ServicePicker: true, MasterMultiSelect: true } },
  })
}

function carInput(w: VueWrapper): HTMLInputElement {
  return w.find('input[placeholder="Toyota Camry"]').element as HTMLInputElement
}

// The popover content is teleported out of the component tree, and reka-ui's
// Presence keeps the closed node around until the exit animation ends — which
// never fires without a layout engine. Read the state attribute instead.
function suggestions(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="popover-content"][data-state="open"] li button'),
  )
}

function suggestion(label: string): HTMLElement | undefined {
  return suggestions().find((el) => el.textContent?.trim() === label)
}

// Gboard: composition opens on the first keystroke and stays open — no
// compositionend until the user types a space or commits a suggestion.
async function composeInto(w: VueWrapper, el: HTMLInputElement, text: string) {
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  el.value = text
  el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }))
  el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  await w.vm.$nextTick()
}

describe('BookingForm — «Марка и модель» под IME (Android/Gboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('оставляет набранный текст нетронутым, пока композиция активна', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')

    await composeInto(w, el, 'bel')

    // Маска капитализирует, но переписывать value во время композиции нельзя —
    // это сбивает сессию ввода Gboard.
    expect(el.value).toBe('bel')
    expect(suggestion('Belgee S50')).toBeTruthy()
    w.unmount()
  })

  it('подставляет выбранную подсказку в поле, а не только в состояние формы', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'bel')

    const item = suggestion('Belgee X50')
    expect(item).toBeTruthy()
    // Android доставляет эмулированный mousedown после touchend.
    item!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await w.vm.$nextTick()

    expect(el.value).toBe('Belgee X50')
    expect(suggestions()).toHaveLength(0)
    w.unmount()
  })

  it('маскирует текст после коммита композиции', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'kia rio')

    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'kia rio' }))
    await w.vm.$nextTick()

    expect(el.value).toBe('Kia Rio')
    w.unmount()
  })

  it('открывает список повторным тапом по уже сфокусированному полю', async () => {
    const w = mountForm()
    const field = w.find('input[placeholder="Toyota Camry"]')
    const el = carInput(w)
    await field.trigger('focus')
    await composeInto(w, el, 'bel')

    const item = suggestion('Belgee S50')!
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await w.vm.$nextTick()
    expect(suggestions()).toHaveLength(0)

    // Поле не теряло фокус (mousedown.prevent), поэтому `focus` больше не
    // придёт — список должен возвращаться по клику.
    await field.trigger('click')
    expect(suggestions().length).toBeGreaterThan(0)
    w.unmount()
  })
})
