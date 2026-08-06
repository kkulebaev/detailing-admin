import { getApiBase } from './api-base'

// `<prefix>-YYYY-MM-DD.csv` in the browser's local date — the download name for
// a CSV export. Built client-side (deterministic; no need to parse the server's
// Content-Disposition, which the blob-download flow ignores anyway).
export function exportFilename(prefix: string): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}-${mm}-${dd}.csv`
}

// Fetches an API endpoint and hands the response to the browser as a file
// download under a caller-chosen filename. Uses raw `fetch` rather than
// `orvalFetch` because the body is a CSV blob, not orval's JSON envelope.
//
// Known gap: a 401 from an expired session is NOT routed through the app's
// unauthorizedHandler here (as it would be via orvalFetch), so it won't redirect
// to the login page — the caller just sees a rejected promise and shows a toast.
// Acceptable for an internal tool; the next JSON request re-triggers the redirect.
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${getApiBase()}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Не удалось скачать файл (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Revoke unconditionally so the blob is freed even if click() throws.
    URL.revokeObjectURL(url)
  }
}
