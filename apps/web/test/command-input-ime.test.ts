// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandHarness from './fixtures/CommandHarness.vue'

// Regression guard for the Android/Gboard IME bug: reka-ui's ListboxFilter
// suppresses model updates while a composition is active and only syncs on
// `compositionend`. Mobile keyboards keep a word in composition until a
// space/commit, so a single-word query never filtered the list. Our
// CommandInput mirrors each `compositionupdate` into the filter so search is
// live mid-word. See apps/web/src/components/ui/command/CommandInput.vue.

const ITEMS = [
  { value: 1, label: 'Демонтаж плёнки' },
  { value: 2, label: 'Полная полировка кузова' },
  { value: 3, label: 'Комплексная химчистка интерьера' },
]

function visibleLabels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-slot="command-item"]')
    .map((n) => n.text().trim())
}

async function mountHarness() {
  const wrapper = mount(CommandHarness, { props: { items: ITEMS }, attachTo: document.body })
  await wrapper.vm.$nextTick()
  // Items register their filter text onMounted — let that flush.
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('CommandInput IME composition filtering', () => {
  it('shows all items before any input', async () => {
    const wrapper = await mountHarness()
    expect(visibleLabels(wrapper)).toHaveLength(ITEMS.length)
    wrapper.unmount()
  })

  it('filters the list live during composition (compositionupdate)', async () => {
    const wrapper = await mountHarness()
    const input = wrapper.find('[data-slot="command-input"]')
    const el = input.element as HTMLInputElement

    // Android Gboard: the field shows composed text but keeps composition open
    // (no compositionend) until a space/commit.
    el.value = 'Демонтаж'
    await input.trigger('compositionstart')
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()

    const labels = visibleLabels(wrapper)
    expect(labels).toEqual(['Демонтаж плёнки'])
    wrapper.unmount()
  })

  it('narrows further as the composition text grows', async () => {
    const wrapper = await mountHarness()
    const input = wrapper.find('[data-slot="command-input"]')
    const el = input.element as HTMLInputElement

    el.value = 'Пол'
    await input.trigger('compositionstart')
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()
    expect(visibleLabels(wrapper)).toEqual(['Полная полировка кузова'])

    // Backing off the query restores the other matches without a compositionend.
    el.value = ''
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()
    expect(visibleLabels(wrapper)).toHaveLength(ITEMS.length)
    wrapper.unmount()
  })
})
