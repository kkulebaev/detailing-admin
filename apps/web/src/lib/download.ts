import { getApiBase } from './api-base'

// `<prefix>-YYYY-MM-DD.csv` в локальной дате браузера — имя скачиваемого файла
// CSV-экспорта. Строится на клиенте (детерминированно; не нужно парсить серверный
// Content-Disposition, который blob-скачивание все равно игнорирует).
export function exportFilename(prefix: string): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}-${mm}-${dd}.csv`
}

// Запрашивает эндпоинт API и отдает ответ браузеру как скачиваемый файл
// с именем, выбранным вызывающим кодом. Использует голый `fetch`, а не
// `orvalFetch`, потому что тело — CSV-blob, а не JSON-конверт orval.
//
// Известный пробел: 401 от истекшей сессии здесь НЕ проходит через
// unauthorizedHandler приложения (как было бы через orvalFetch), поэтому редиректа
// на страницу логина не будет — вызывающий код просто получит rejected promise и покажет тост.
// Для внутреннего инструмента приемлемо: следующий JSON-запрос снова вызовет редирект.
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
    // Освобождаем безусловно, чтобы blob освободился, даже если click() бросит исключение.
    URL.revokeObjectURL(url)
  }
}
