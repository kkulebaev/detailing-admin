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

describe('LoginPage password field', () => {
  it('toggles visibility without losing the typed value', async () => {
    mountPage()
    await passwordInput().fill('secret-123')
    await expect.element(passwordInput()).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Показать пароль' }).click()

    await expect.element(passwordInput()).toHaveAttribute('type', 'text')
    await expect.element(passwordInput()).toHaveValue('secret-123')
    await expect.element(page.getByRole('button', { name: 'Скрыть пароль' })).toBeVisible()
  })

  it('renders the field at the height of the login field beside it', async () => {
    mountPage()
    await expect.element(passwordInput()).toBeVisible()

    const login = page.getByLabelText('Логин').element()
    expect(inputGroup().getBoundingClientRect().height).toBe(login.getBoundingClientRect().height)
  })

  it('moves the focus ring onto the group when the input gets focus', async () => {
    mountPage()
    await expect.element(passwordInput()).toBeVisible()
    const shadowAtRest = getComputedStyle(inputGroup()).boxShadow

    await passwordInput().click()

    await expect.poll(() => getComputedStyle(inputGroup()).boxShadow).not.toBe(shadowAtRest)
  })
})
