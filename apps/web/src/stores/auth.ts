import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LoginRequest, Role, UpdateProfileRequest, UserPublic } from '@detailing-admin/shared'
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
  // False until the first `fetchMe()` settles — the router guard uses this to
  // fetch the session exactly once per app load instead of on every navigation.
  const ready = ref(false)

  const role = computed<Role | null>(() => user.value?.role ?? null)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // Full name once the user has filled it in; falls back to the login for
  // accounts provisioned before names existed (empty firstName/lastName).
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
    // The server re-mints the cookie; mirror the new name locally so the
    // sidebar/profile update without a round-trip to /me.
    if (result.ok) user.value = result.user
    return result
  }

  async function logout() {
    try {
      await apiLogout()
    } catch {
      // Best-effort: the cookie is cleared server-side when this succeeds,
      // but the UI should still drop to a logged-out state on a network error.
    } finally {
      user.value = null
    }
  }

  // Invoked by the global 401 handler (orval-mutator.ts) when any
  // authenticated request is rejected — clears local state without another
  // round-trip, since the server already rejected the cookie.
  function clearSession() {
    user.value = null
    ready.value = true
  }

  return {
    user,
    ready,
    role,
    isAdmin,
    displayName,
    fetchMe,
    login,
    updateProfile,
    logout,
    clearSession,
  }
})
