// Граничный хелпер, общий для всех доменных api-обёрток. Сгенерированные orval
// функции возвращают конверты `{ data, status, headers }`, типизированные как
// discriminated union по статусам; здесь мы расширяем `data` до `unknown` и приводим к
// варианту ApiResult, который видит потребитель. OpenAPI-спека генерируется из тех
// же Zod-схем, что используют роуты, поэтому оба union'а структурно
// идентичны — схлопывать их на этой единственной границе безопасно.
//
// Сетевые ошибки и сбои парсинга JSON пробрасываются как исключения (Pinia
// Colada отдаёт их через `state.error` / `asyncStatus === 'error'`).
export async function unwrap<T>(call: () => Promise<{ data: unknown }>): Promise<T> {
  const { data } = await call()
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return data as T
}
