import type { BookingApiResult } from '@detailing-admin/shared/api'

const TTL_MS = 5 * 60 * 1000

interface Entry {
  at: number
  result: BookingApiResult
}

const cache = new Map<string, Entry>()

export function sweep(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.at > TTL_MS) {
      cache.delete(key)
    }
  }
}

export function get(key: string): BookingApiResult | undefined {
  sweep()
  return cache.get(key)?.result
}

export function set(key: string, result: BookingApiResult): void {
  cache.set(key, { at: Date.now(), result })
}

/** Evict a key from the cache. Named with trailing underscore because `delete` is reserved. */
export function delete_(key: string): void {
  cache.delete(key)
}

/** Clears the cache — for use in tests only. */
export function _clearForTest(): void {
  cache.clear()
}
