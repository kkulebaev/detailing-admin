export type ApiResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: 'validation'; issues: Array<{ path: (string | number)[]; message: string }> }
  | { ok: false; error: 'sheets'; code?: number; message: string }
  | { ok: false; error: 'internal' }
  | {
      ok: false
      error: 'unavailable'
      reason: 'headers_mismatch' | 'not_configured'
      // Present only when reason === 'headers_mismatch'
      column_index?: number
      expected?: string
      observed?: string
      // Present only when reason === 'not_configured' — safe, non-secret boot error
      message?: string
    }

/** Concrete result type for POST /api/bookings */
export type BookingApiResult = ApiResult<{
  idempotent: boolean
  updatedRange: string
  updatedRow: number
}>
