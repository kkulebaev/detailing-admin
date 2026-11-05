// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChangePasswordForm from '../src/components/ChangePasswordForm.vue'
import { changePassword } from '../src/lib/auth-api'

vi.mock('../src/lib/auth-api', () => ({ changePassword: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NEW_PASSWORD = 'new-password-123'

function inputs(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('input')
}

function toggles(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button[aria-pressed]')
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.mocked(changePassword).mockReset()
  })

  it('toggles each field on its own and keeps the typed value', async () => {
    const wrapper = mount(ChangePasswordForm)
    await inputs(wrapper)[1]!.setValue(NEW_PASSWORD)

    await toggles(wrapper)[1]!.trigger('click')

    expect(inputs(wrapper).map((i) => i.attributes('type'))).toEqual([
      'password',
      'text',
      'password',
    ])
    expect(inputs(wrapper)[1]!.element.value).toBe(NEW_PASSWORD)
    expect(toggles(wrapper)[1]!.attributes('aria-label')).toBe('Скрыть пароль')

    await toggles(wrapper)[1]!.trigger('click')

    expect(inputs(wrapper)[1]!.attributes('type')).toBe('password')
  })

  it('does not submit the form when the toggle is clicked', async () => {
    const wrapper = mount(ChangePasswordForm)

    await toggles(wrapper)[0]!.trigger('click')
    await flushPromises()

    expect(toggles(wrapper)[0]!.attributes('type')).toBe('button')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('wires form attributes to the input, not the wrapper', () => {
    const wrapper = mount(ChangePasswordForm)
    const [current, , confirm] = inputs(wrapper)

    expect(current!.attributes('autocomplete')).toBe('current-password')
    expect(confirm!.attributes('id')).toBe('confirm-password')
    for (const input of inputs(wrapper)) {
      expect(input.attributes('data-slot')).toBe('input-group-control')
    }
    expect(wrapper.find('[role="group"][autocomplete]').exists()).toBe(false)
  })

  it('submits the typed passwords and hides every field after success', async () => {
    vi.mocked(changePassword).mockResolvedValue({ ok: true } as never)
    const wrapper = mount(ChangePasswordForm)
    const [current, next, confirm] = inputs(wrapper)
    await current!.setValue('old-password-123')
    await next!.setValue(NEW_PASSWORD)
    await confirm!.setValue(NEW_PASSWORD)
    for (const toggle of toggles(wrapper)) await toggle.trigger('click')

    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => {
      expect(inputs(wrapper).map((i) => i.attributes('type'))).toEqual([
        'password',
        'password',
        'password',
      ])
    })
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password-123',
      newPassword: NEW_PASSWORD,
    })
    for (const input of inputs(wrapper)) {
      expect(input.element.value).toBe('')
    }
  })

  it('stays visible and keeps values when the passwords do not match', async () => {
    const wrapper = mount(ChangePasswordForm)
    const [current, next, confirm] = inputs(wrapper)
    await current!.setValue('old-password-123')
    await next!.setValue(NEW_PASSWORD)
    await confirm!.setValue('something-else-123')
    await toggles(wrapper)[2]!.trigger('click')

    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Пароли не совпадают')
    })
    expect(changePassword).not.toHaveBeenCalled()
    expect(inputs(wrapper)[2]!.attributes('type')).toBe('text')
    expect(inputs(wrapper)[2]!.element.value).toBe('something-else-123')
  })
})
