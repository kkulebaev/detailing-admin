import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  canEditBookings as roleCanEditBookings,
  canSeeAmounts as roleCanSeeAmounts,
  type LoginRequest,
  type Role,
  type UpdateProfileRequest,
  type UserPublic,
} from '@detailing-admin/shared'
import {
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  updateProfile as apiUpdateProfile,
  type LoginResult,
  type UpdateProfileResult,
} from '@/lib/auth-api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserPublic | null>(null)
  // False, пока не завершится первый `fetchMe()`, — guard роутера по нему
  // запрашивает сессию ровно один раз за загрузку приложения, а не на каждой навигации.
  const ready = ref(false)

  const role = computed<Role | null>(() => user.value?.role ?? null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const canSeeAmounts = computed(() => !!role.value && roleCanSeeAmounts(role.value))
  const canEditBookings = computed(() => !!role.value && roleCanEditBookings(role.value))

  // Полное имя, когда пользователь его заполнил; иначе — логин, для
  // аккаунтов, заведённых до появления имён (пустые firstName/lastName).
  const displayName = computed(() => {
    const u = user.value
    if (!u) return ''
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.login
  })

  async function fetchMe() {
    try {
      const result = await apiMe()
      user.value = result.ok ? result.user : null
    } catch {
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(credentials: LoginRequest): Promise<LoginResult> {
    const result = await apiLogin(credentials)
    if (result.ok) {
      user.value = result.user
      ready.value = true
    }
    return result
  }

  async function updateProfile(payload: UpdateProfileRequest): Promise<UpdateProfileResult> {
    const result = await apiUpdateProfile(payload)
    // Сервер перевыпускает cookie; повторяем новое имя локально, чтобы
    // сайдбар/профиль обновились без лишнего запроса к /me.
    if (result.ok) user.value = result.user
    return result
  }

  async function logout() {
    try {
      await apiLogout()
    } catch {
      // Best-effort: при успехе cookie очищается на сервере,
      // но при сетевой ошибке UI всё равно должен перейти в разлогиненное состояние.
    } finally {
      user.value = null
    }
  }

  // Вызывается глобальным обработчиком 401 (orval-mutator.ts), когда любой
  // авторизованный запрос отклонён, — очищает локальное состояние без ещё одного
  // запроса, ведь сервер уже отверг cookie.
  function clearSession() {
    user.value = null
    ready.value = true
  }

  return {
    user,
    ready,
    role,
    isAdmin,
    canSeeAmounts,
    canEditBookings,
    displayName,
    fetchMe,
    login,
    updateProfile,
    logout,
    clearSession,
  }
})
