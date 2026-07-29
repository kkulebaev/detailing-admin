import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LoginRequest, Role, UserPublic } from '@detailing-admin/shared'
import { login as apiLogin, logout as apiLogout, me as apiMe, type LoginResult } from '@/lib/auth-api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserPublic | null>(null)
  // False until the first `fetchMe()` settles — the router guard uses this to
  // fetch the session exactly once per app load instead of on every navigation.
  const ready = ref(false)

  const role = computed<Role | null>(() => user.value?.role ?? null)
  const isAdmin = computed(() => user.value?.role === 'admin')

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

  return { user, ready, role, isAdmin, fetchMe, login, logout, clearSession }
})
