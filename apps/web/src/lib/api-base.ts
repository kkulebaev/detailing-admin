// Единый источник базового URL API, общий для orvalFetch и хелпера скачивания
// через raw-fetch — разрешение в одном месте не дает двум путям
// разойтись.
//
// Прод проксирует /api через web-origin, чтобы auth-cookie оставалась
// first-party (SameSite=Lax) — см. .omc/plans/auth-rbac-plan.md §3-bis. Поэтому
// относительное значение по умолчанию (пустая строка) корректно и в dev, и в prod;
// VITE_API_BASE_URL остается явным переопределением, чтобы направить запросы на другой
// бэкенд. Cross-origin база делает cookie third-party, а такие Safari/Chrome
// молча отбрасывают — так что безопасен именно пустой default, а не захардкоженный origin.
export function getApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL
  return typeof envBase === 'string' && envBase.length > 0 ? envBase : ''
}
