import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import ChangePasswordForm from '../src/components/ChangePasswordForm.vue'
import { changePassword } from '../src/lib/auth-api'

vi.mock('../src/lib/auth-api', () => ({ changePassword: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NEW_PASSWORD = 'new-password-123'

const current = () => page.getByLabelText('Текущий пароль')
const next = () => page.getByLabelText('Новый пароль')
const confirm = () => page.getByLabelText('Повторите новый пароль')
const fields = () => [current(), next(), confirm()]

// By position: a toggle's name flips with its state, and all three share it.
const toggle = (index: number) =>
  page.getByRole('button', { name: /^(Показать|Скрыть) пароль$/ }).nth(index)
const submit = () => page.getByRole('button', { name: 'Сменить пароль' })

function mountForm() {
  mount(ChangePasswordForm, { attachTo: document.body })
}

enableAutoUnmount(afterEach)

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.mocked(changePassword).mockReset()
  })

  it('toggles each field on its own and keeps the typed value', async () => {
    mountForm()
    await next().fill(NEW_PASSWORD)

    await toggle(1).click()

    await expect.element(current()).toHaveAttribute('type', 'password')
    await expect.element(next()).toHaveAttribute('type', 'text')
    await expect.element(confirm()).toHaveAttribute('type', 'password')
    await expect.element(next()).toHaveValue(NEW_PASSWORD)
    await expect.element(toggle(1)).toHaveAccessibleName('Скрыть пароль')

    await toggle(1).click()

    await expect.element(next()).toHaveAttribute('type', 'password')
  })

  it('does not submit the form when the toggle is clicked', async () => {
    vi.mocked(changePassword).mockResolvedValue({ ok: true } as never)
    mountForm()
    // A valid form, or a submitting toggle would be stopped by validation anyway.
    await current().fill('old-password-123')
    await next().fill(NEW_PASSWORD)
    await confirm().fill(NEW_PASSWORD)

    await toggle(0).click()

    await expect.element(toggle(0)).toHaveAttribute('aria-pressed', 'true')
    await expect.element(toggle(0)).toHaveAttribute('type', 'button')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('wires form attributes to the input, not the wrapper', async () => {
    mountForm()

    await expect.element(current()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(confirm()).toHaveAttribute('id', 'confirm-password')
    for (const field of fields()) {
      await expect.element(field).toHaveAttribute('data-slot', 'input-group-control')
    }
    expect(document.querySelector('[role="group"][autocomplete]')).toBeNull()
  })

  it('submits the typed passwords and hides every field after success', async () => {
    vi.mocked(changePassword).mockResolvedValue({ ok: true } as never)
    mountForm()
    await current().fill('old-password-123')
    await next().fill(NEW_PASSWORD)
    await confirm().fill(NEW_PASSWORD)
    for (const index of [0, 1, 2]) await toggle(index).click()

    await submit().click()

    await vi.waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password-123',
        newPassword: NEW_PASSWORD,
      })
    })
    for (const field of fields()) {
      await expect.element(field).toHaveAttribute('type', 'password')
      await expect.element(field).toHaveValue('')
    }
  })

  it('stays visible and keeps values when the passwords do not match', async () => {
    mountForm()
    await current().fill('old-password-123')
    await next().fill(NEW_PASSWORD)
    await confirm().fill('something-else-123')
    await toggle(2).click()

    await submit().click()

    await expect.element(page.getByText('Пароли не совпадают')).toBeVisible()
    expect(changePassword).not.toHaveBeenCalled()
    await expect.element(confirm()).toHaveAttribute('type', 'text')
    await expect.element(confirm()).toHaveValue('something-else-123')
  })
})
