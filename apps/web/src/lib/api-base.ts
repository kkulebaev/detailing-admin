// Single source for the API base URL, shared by orvalFetch and the raw-fetch
// download helper — keeping the resolution in one place stops the two paths
// from drifting.
//
// Prod reverse-proxies /api through the web origin so the auth cookie stays
// first-party (SameSite=Lax) — see .omc/plans/auth-rbac-plan.md §3-bis. The
// relative default (empty string) is therefore correct in both dev and prod;
// VITE_API_BASE_URL remains an explicit override for pointing at a different
// backend. A cross-origin base makes the cookie third-party, which Safari/Chrome
// silently drop — so an empty default is the safe one, not a hardcoded origin.
export function getApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL
  return typeof envBase === 'string' && envBase.length > 0 ? envBase : ''
}
