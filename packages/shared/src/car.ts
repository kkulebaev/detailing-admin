// Единый формат склейки «марка/модель + гос. номер» для колонки E листа и
// зеркала `bookings.car`. Раньше склейка жила в форме (BookingForm.vue) —
// перенос на сервер централизует формат в одном тестируемом месте перед
// cutover. Воспроизводит прежнее `[car, plate].filter(Boolean).join(', ')`:
// при пустом/отсутствующем plate возвращает голый car без хвостового ", ".
export function joinCar(car: string, plate?: string): string {
  return [car, plate].filter(Boolean).join(', ')
}

// Нормализация ключа уникальности для таблицы `client_cars`. UNIQUE стоит на
// сырых колонках, поэтому дедупликация через onConflictDoNothing работает
// только если писать уже нормализованные значения.
//
// make/model: trim + схлопнуть внутренние пробелы.
// plate (isPlate=true): дополнительно upper-case + убрать все пробелы —
//   «а 123 аа 77» и «А123АА77» дают один ключ.
//
// Основной путь (форма) уже нормализует ввод масками; этот хелпер нужен для
// ручного CRUD и бэкфилла, обходящих маски. Остаточные пределы (кириллица/
// латиница-двойники А/A) — известное ограничение обходных путей.
export function normalizeCarKey(s: string, isPlate = false): string {
  const collapsed = s.trim().replace(/\s+/g, ' ')
  return isPlate ? collapsed.toUpperCase().replace(/\s+/g, '') : collapsed
}
