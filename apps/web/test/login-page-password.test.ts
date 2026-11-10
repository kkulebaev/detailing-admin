import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import LoginPage from '../src/pages/LoginPage.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('../src/router', () => ({ homeRouteFor: () => '/' }))
vi.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({ login: vi.fn() }),
}))

const passwordInput = () => page.getByLabelText('Пароль')
const inputGroup = () =>
  passwordInput().element().closest<HTMLElement>('[data-slot="input-group"]')!

function mountPage() {
  mount(LoginPage, { attachTo: document.body })
}

enableAutoUnmount(afterEach)

describe('LoginPage — поле пароля', () => {
  it('переключает видимость, не теряя введенное значение', async () => {
    mountPage()
    await passwordInput().fill('secret-123')
    await expect.element(passwordInput()).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Показать пароль' }).click()

    await expect.element(passwordInput()).toHaveAttribute('type', 'text')
    await expect.element(passwordInput()).toHaveValue('secret-123')
    await expect.element(page.getByRole('button', { name: 'Скрыть пароль' })).toBeVisible()
  })

  it('рисует поле той же высоты, что и соседнее поле логина', async () => {
    mountPage()
    await expect.element(passwordInput()).toBeVisible()

    const login = page.getByLabelText('Логин').element()
    expect(inputGroup().getBoundingClientRect().height).toBe(login.getBoundingClientRect().height)
  })

  it('переносит кольцо фокуса на группу, когда input получает фокус', async () => {
    mountPage()
    await expect.element(passwordInput()).toBeVisible()
    const shadowAtRest = getComputedStyle(inputGroup()).boxShadow

    await passwordInput().click()

    await expect.poll(() => getComputedStyle(inputGroup()).boxShadow).not.toBe(shadowAtRest)
  })
})
