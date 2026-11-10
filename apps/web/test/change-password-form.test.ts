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

// По позиции: имя переключателя меняется вместе с состоянием, и у всех трех оно общее.
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

  it('переключает каждое поле отдельно и сохраняет введенное значение', async () => {
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

  it('не отправляет форму по клику на переключатель', async () => {
    vi.mocked(changePassword).mockResolvedValue({ ok: true } as never)
    mountForm()
    // Форма валидна, иначе отправку по переключателю все равно остановила бы валидация.
    await current().fill('old-password-123')
    await next().fill(NEW_PASSWORD)
    await confirm().fill(NEW_PASSWORD)

    await toggle(0).click()

    await expect.element(toggle(0)).toHaveAttribute('aria-pressed', 'true')
    await expect.element(toggle(0)).toHaveAttribute('type', 'button')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('вешает атрибуты формы на input, а не на обертку', async () => {
    mountForm()

    await expect.element(current()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(confirm()).toHaveAttribute('id', 'confirm-password')
    for (const field of fields()) {
      await expect.element(field).toHaveAttribute('data-slot', 'input-group-control')
    }
    expect(document.querySelector('[role="group"][autocomplete]')).toBeNull()
  })

  it('отправляет введенные пароли и после успеха скрывает все поля', async () => {
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

  it('при несовпадении паролей остается видимым и сохраняет значения', async () => {
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
