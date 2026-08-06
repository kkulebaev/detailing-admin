// Shared constants for the CSV export routes (bookings + clients), kept in one
// place so the two routes can't drift apart.

// Hard cap on an export's rows — a safeguard against OOM on a runaway dataset,
// not an expected limit (the mirror is small). Hitting it truncates the file
// silently and logs a warning.
export const EXPORT_CAP = 10000

// The shop operates in Moscow time (+7 phones, ru locale). Timestamps stored in
// UTC are rendered in this zone in exports so «Создано» matches the local time
// staff see, not raw UTC.
export const SHOP_TIMEZONE = 'Europe/Moscow'
