import { SHOP_TIMEZONE } from './export.js'

// Календарные правила (окно правки часов, заявки на график) считаются по дню
// студии, а не по UTC-дню сервера: около полуночи они расходятся.
export function shopToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE }).format(new Date())
}
