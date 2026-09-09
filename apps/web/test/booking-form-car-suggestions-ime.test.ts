// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { Client } from '@/lib/clients-api'

// «Марка и модель» suggests as you type. Earlier cuts hung the pick on
// `mousedown`/`click` and closed the list on `blur`, and Android never landed a
// selection — an event log from an emulated Pixel showed why: the sequence is
// pointerdown → mousedown → focusout → pointerup, and `mouseup`/`click` never
// arrive at all because the item is gone by then. So selection rides on
// `pointerup`, `pointerdown.prevent` keeps the focus (and the keyboard) in the
// field, and a drag past the slop threshold scrolls instead of selecting.
// Vue's v-model also refuses to write the DOM while Gboard holds a composition,
// hence the explicit commit in `selectCar`.

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
function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('ul[data-car-suggestions] li[role="option"]'))
}

function tap(el: HTMLElement, { dx = 0, dy = 0 } = {}) {
  const base = { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }
  el.dispatchEvent(new MouseEvent('pointerdown', base))
  el.dispatchEvent(new MouseEvent('pointerup', { ...base, clientX: 100 + dx, clientY: 100 + dy }))
}

function option(label: string): HTMLElement | undefined {
  return options().find((el) => el.textContent?.trim() === label)
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

describe('BookingForm — «Марка и модель»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('показывает подсказки прямо при наборе', async () => {
    const w = mountForm()
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, carInput(w), 'bel')

    expect(options().map((el) => el.textContent?.trim())).toEqual([
      'Belgee S50',
      'Belgee X50',
      'Belgee X70',
    ])
    w.unmount()
  })

  it('подставляет подсказку по тапу, не дожидаясь коммита композиции', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'bel')

    tap(option('Belgee X50')!)
    await w.vm.$nextTick()

    expect(el.value).toBe('Belgee X50')
    expect(options()).toHaveLength(0)
    w.unmount()
  })

  it('оставляет фокус в поле после выбора', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'bel')

    tap(option('Belgee X70')!)
    await w.vm.$nextTick()

    // Уехавший на поповер фокус гасит мобильную клавиатуру.
    expect(document.activeElement).toBe(el)
    w.unmount()
  })

  it('пункты списка не перехватывают фокус у поля', async () => {
    const w = mountForm()
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, carInput(w), 'bel')

    // `<button>` здесь уводил бы фокус на touchend — раньше именно это давало
    // `blur`, который сносил список до того, как тап успевал выбрать пункт.
    for (const el of options()) {
      expect(el.tagName).toBe('LI')
      expect(el.hasAttribute('tabindex')).toBe(false)
    }
    w.unmount()
  })

  it('протяжка по списку скроллит, а не выбирает', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'bel')

    tap(option('Belgee X70')!, { dy: -60 })
    await w.vm.$nextTick()

    expect(el.value).toBe('bel')
    expect(options().length).toBeGreaterThan(0)
    w.unmount()
  })

  it('закрывает список по тапу мимо поля и списка', async () => {
    const w = mountForm()
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, carInput(w), 'bel')
    expect(options().length).toBeGreaterThan(0)

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    await w.vm.$nextTick()

    expect(options()).toHaveLength(0)
    w.unmount()
  })

  it('не закрывает список по одному только blur поля', async () => {
    const w = mountForm()
    const field = w.find('input[placeholder="Toyota Camry"]')
    await field.trigger('focus')
    await composeInto(w, carInput(w), 'bel')

    await field.trigger('blur')

    expect(options().length).toBeGreaterThan(0)
    w.unmount()
  })

  it('возвращает список повторным тапом по уже сфокусированному полю', async () => {
    const w = mountForm()
    const field = w.find('input[placeholder="Toyota Camry"]')
    await field.trigger('focus')
    await composeInto(w, carInput(w), 'bel')

    tap(option('Belgee S50')!)
    await w.vm.$nextTick()
    expect(options()).toHaveLength(0)

    await field.trigger('click')
    expect(options().length).toBeGreaterThan(0)
    w.unmount()
  })

  it('оставляет набранный текст нетронутым, пока композиция активна', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'bel')

    // Маска капитализирует, но переписывать value во время композиции нельзя —
    // это сбивает сессию ввода Gboard.
    expect(el.value).toBe('bel')
    w.unmount()
  })

  it('маскирует свободный ввод после коммита композиции', async () => {
    const w = mountForm()
    const el = carInput(w)
    await w.find('input[placeholder="Toyota Camry"]').trigger('focus')
    await composeInto(w, el, 'kia rio')

    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'kia rio' }))
    await w.vm.$nextTick()

    expect(el.value).toBe('Kia Rio')
    w.unmount()
  })
})
