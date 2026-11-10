import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandHarness from './fixtures/CommandHarness.vue'

// Защита от регрессии бага IME на Android/Gboard: ListboxFilter из reka-ui
// глушит обновления модели, пока композиция активна, и синхронизируется только на
// `compositionend`. Мобильные клавиатуры держат слово в композиции до пробела или
// коммита, поэтому запрос из одного слова никогда не фильтровал список. Наш
// CommandInput зеркалит каждый `compositionupdate` в фильтр, и поиск работает
// прямо посреди слова. См. apps/web/src/components/ui/command/CommandInput.vue.

const ITEMS = [
  { value: 1, label: 'Демонтаж плёнки' },
  { value: 2, label: 'Полная полировка кузова' },
  { value: 3, label: 'Комплексная химчистка интерьера' },
]

function visibleLabels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-slot="command-item"]').map((n) => n.text().trim())
}

async function mountHarness() {
  const wrapper = mount(CommandHarness, { props: { items: ITEMS }, attachTo: document.body })
  await wrapper.vm.$nextTick()
  // Пункты регистрируют текст для фильтра в onMounted — даём этому отработать.
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('CommandInput — фильтрация во время IME-композиции', () => {
  it('показывает все пункты до какого-либо ввода', async () => {
    const wrapper = await mountHarness()
    expect(visibleLabels(wrapper)).toHaveLength(ITEMS.length)
    wrapper.unmount()
  })

  it('фильтрует список на лету во время композиции (compositionupdate)', async () => {
    const wrapper = await mountHarness()
    const input = wrapper.find('[data-slot="command-input"]')
    const el = input.element as HTMLInputElement

    // Android Gboard: поле показывает набранный текст, но держит композицию открытой
    // (без compositionend) до пробела или коммита.
    el.value = 'Демонтаж'
    await input.trigger('compositionstart')
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()

    const labels = visibleLabels(wrapper)
    expect(labels).toEqual(['Демонтаж плёнки'])
    wrapper.unmount()
  })

  it('сужает список дальше по мере роста текста композиции', async () => {
    const wrapper = await mountHarness()
    const input = wrapper.find('[data-slot="command-input"]')
    const el = input.element as HTMLInputElement

    el.value = 'Пол'
    await input.trigger('compositionstart')
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()
    expect(visibleLabels(wrapper)).toEqual(['Полная полировка кузова'])

    // Укорачивание запроса возвращает остальные совпадения без compositionend.
    el.value = ''
    await input.trigger('compositionupdate')
    await wrapper.vm.$nextTick()
    expect(visibleLabels(wrapper)).toHaveLength(ITEMS.length)
    wrapper.unmount()
  })
})
