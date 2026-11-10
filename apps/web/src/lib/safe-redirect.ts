// Защищает query-параметр `?redirect=` после логина от open-redirect:
// ведущие `//` или `/\` браузер трактует как URL относительно схемы
// (`//evil.com` резолвится как `https://evil.com`), поэтому «начинается со слеша»
// само по себе недостаточно — путь ещё и не должен выглядеть как начало хоста.
export function isSafeRedirect(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}
