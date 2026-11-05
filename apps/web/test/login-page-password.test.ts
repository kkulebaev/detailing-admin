// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import LoginPage from '../src/pages/LoginPage.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('../src/router', () => ({ homeRouteFor: () => '/' }))
vi.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({ login: vi.fn() }),
}))

function passwordInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('input[autocomplete="current-password"]')
}

describe('LoginPage password field', () => {
  it('toggles visibility without losing the typed value', async () => {
    const wrapper = mount(LoginPage)
    const toggle = wrapper.find('button[aria-pressed]')
    await passwordInput(wrapper).setValue('secret-123')

    expect(passwordInput(wrapper).attributes('type')).toBe('password')
    await toggle.trigger('click')

    expect(passwordInput(wrapper).attributes('type')).toBe('text')
    expect((passwordInput(wrapper).element as HTMLInputElement).value).toBe('secret-123')
    expect(toggle.attributes('aria-label')).toBe('Скрыть пароль')
  })

  it('keeps the label pointing at the input and the height on the group', () => {
    const wrapper = mount(LoginPage)
    const input = passwordInput(wrapper)
    const group = wrapper.find('[data-slot="input-group"]')

    const label = wrapper.findAll('label').find((l) => l.text() === 'Пароль')
    expect(input.attributes('id')).toBe(label!.attributes('for'))
    expect(group.classes()).toContain('h-11')
    expect(input.classes()).not.toContain('h-11')
  })

  it('keeps the focus ring selector matching the input', () => {
    const wrapper = mount(LoginPage)

    expect(passwordInput(wrapper).attributes('data-slot')).toBe('input-group-control')
  })
})
