import { StatusCodes } from '@detailing-admin/shared'
import { getApiBase } from './api-base'

// Своя обёртка над `fetch`, которую orval вызывает вместо встроенного `fetch()` в
// каждом сгенерированном эндпоинте. Задачи:
//   1. Подставить базовый URL API из env, если URL запроса относительный.
//   2. Отправлять auth-cookie с каждым запросом (`credentials: 'include'`).
//   3. Направлять голый 401 в зарегистрированный обработчик unauthorized — кроме
//      самих эндпоинтов авторизации, см. AUTH_EXEMPT_PATHS.
//   4. Возвращать конверт orval `{ data, status, headers }` без явного
//      приведения типа в месте вызова — сужение дженерика происходит здесь
//      один раз, за одной директивой disable. Граница `unwrap` в
//      api-client.ts не делает проверки в рантайме, так что корректность зависит от
//      того, действительно ли OpenAPI-спека и ответ роута соответствуют типам.

// Вычисляется один раз при загрузке модуля; обоснование для dev/prod см. в getApiBase.
const apiBase = getApiBase()

export interface OrvalEnvelope<T> {
  data: T
  status: number
  headers: Headers
}

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

// Регистрируется лениво из main.ts, а не импортируется сюда напрямую: auth-api.ts (и
// всё, что его вызывает) лежит ниже этого модуля, а store/router,
// которым нужно реагировать на 401, — выше; статический импорт в любую
// сторону дал бы цикл.
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler
}

// `/login` показывает своё сообщение «неверный пароль», а не редиректит
// сам на себя; `/me` отвечает 401 каждому анонимному посетителю при первой загрузке, и это
// нормально, а не истечение сессии (считать его таковым — значит зациклить редирект);
// `/logout` очищает cookie по определению.
const AUTH_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/me', '/api/auth/logout']

export async function orvalFetch<T extends OrvalEnvelope<unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${apiBase}${url}`
  const res = await fetch(fullUrl, { ...init, credentials: 'include' })
  if (res.status === StatusCodes.UNAUTHORIZED && !AUTH_EXEMPT_PATHS.includes(url.split('?')[0])) {
    unauthorizedHandler?.()
  }
  const bodylessStatuses: number[] = [
    StatusCodes.NO_CONTENT,
    StatusCodes.RESET_CONTENT,
    StatusCodes.NOT_MODIFIED,
  ]
  const body = bodylessStatuses.includes(res.status) ? null : await res.text()
  const data: unknown = body ? JSON.parse(body) : {}
  const envelope: OrvalEnvelope<unknown> = { data, status: res.status, headers: res.headers }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return envelope as T
}
