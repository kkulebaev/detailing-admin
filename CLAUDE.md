# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile booking form for a detailing shop. One submission → one row appended to a fixed Google Sheet (`SPREADSHEET_ID`, tab `Запись 2026`). No database, no auth — this is intentional, time-boxed risk (see `.omc/plans/mvp-booking-form.md` §11).

Authoritative architectural plan with all decisions, data contract, and risks: **`.omc/plans/mvp-booking-form.md`** — read it before any non-trivial change.

## Commands

Node 22+, pnpm 11+. Run from repo root:

```bash
pnpm install              # workspace install
pnpm dev                  # parallel: web (5173) + api (3000)
pnpm build                # vue-tsc + vite build (web); tsup (api)
pnpm test                 # vitest in all packages
pnpm typecheck            # tsc/vue-tsc --noEmit in all packages
```

Per-package (run from package dir or via `pnpm --filter`):

```bash
pnpm --filter @detailing-admin/api dev         # tsx watch
pnpm --filter @detailing-admin/api test        # vitest
pnpm --filter @detailing-admin/web typecheck   # vue-tsc --noEmit
pnpm --filter @detailing-admin/shared test     # vitest
```

Single test file: `pnpm --filter <pkg> exec vitest run path/to/file.test.ts`

Local dev needs `apps/api/.env` (copy from `apps/api/.env.example`, supply `GOOGLE_SERVICE_ACCOUNT_JSON_B64`). Web `.env.local` is optional — Vite dev server proxies `/api` to `localhost:3000` by default; override with `VITE_API_PROXY_TARGET` to point dev at a remote API.

## Architecture

pnpm workspace, three packages:

- **`packages/shared`** — single Zod schema (`bookingSchema`) is the wire contract. No build step; both apps import `.ts` directly via tsconfig path aliases (`@detailing-admin/shared/*` resolves to `packages/shared/src/*.ts`). Exports: schema, enums (`READINESS`, `MASTERS`), helpers (`normalizePhone`, `parseDdmmyyyy`), `bookingToRow`, `EXPECTED_HEADERS`, and the `ApiResult` discriminated union.
- **`apps/api`** — Hono on `@hono/node-server`. Two routes: `POST /api/bookings`, `GET /healthz`. Sheets writes via `googleapis`. Module-level state machine for boot health (see below).
- **`apps/web`** — Vue 3 + Vite + Tailwind v4 + shadcn-vue. The entire form is one component: `apps/web/src/components/BookingForm.vue`. `vee-validate` + `@vee-validate/zod` consumes the shared schema via `toTypedSchema(bookingSchema)`.

### Boot state machine (`apps/api/src/boot.ts`)

On startup `init()` calls `verifyHeaders()` (reads `A1:K1` from the sheet) and sets `_bootState` to one of `'ok' | 'headers_mismatch' | 'not_configured'`. **It never calls `process.exit`** — the listener always binds. While `_bootState !== 'ok'`:
- `GET /healthz` and `POST /api/bookings` return HTTP 503 with the `unavailable` variant of `ApiResult`.
- The booking route short-circuits **before** validation, idempotency lookup, and any Sheets call — no per-request log line (the single `boot.headers.mismatch` / `boot.init.error` line at startup is the signal).
- Recovery requires a process restart after fixing the sheet (or updating `EXPECTED_HEADERS`).

This is deliberate: Railway treats a crash-loop as zero healthy revisions, hiding the root cause. A live listener returning structured 503s is observable.

### `EXPECTED_HEADERS` is a byte-exact contract

`packages/shared/src/sheet-row.ts` pins the 11 header strings in column order, **including the typo `Ответсвенный` in K** (preserved verbatim — fixing it in the sheet breaks the boot check until `EXPECTED_HEADERS` is updated in the same PR). Never rename a header on one side without the other.

### Column-A serialization quirk

`bookingToRow()` writes single-day bookings as a bare `DD.MM.YYYY` string (parsed by Sheets as a DATE under ru-RU locale + `valueInputOption=USER_ENTERED`). Multi-day bookings are written as `'DD.MM.YYYY-DD.MM.YYYY'` (or with appended times) **with a leading single apostrophe** to force TEXT cell type — without the apostrophe Sheets corrupts the hyphenated value. The `bookingSchema.transform()` collapses `dateFrom === dateTo` to the single-day shape (`dateTo: undefined`) so identical pickers produce a DATE cell, not a `'04.06.2026-04.06.2026` TEXT cell.

### Idempotency

Client (`BookingForm.vue`) generates a UUID v4 at form mount and reuses it across retries until first success. The API holds an in-memory `Map` with 5-minute TTL (`apps/api/src/idempotency.ts`). Only `ok: true` results are cached — non-ok entries are evicted on hit. There is **one** Railway instance; the in-memory map is sufficient for MVP. Two instances would require a shared store.

### Phone normalization edge case

`normalizePhone()` accepts mixed legacy formats and emits E.164 `+7XXXXXXXXXX` (or `''`). The Vue form binds the phone field to the **raw user-typed string**, not to the schema's parsed output — binding to the parsed value would rewrite the visible input mid-typing and trash the cursor. Validation is permissive per-keystroke (`z.string().max(40)`) and strict only at submit time via the schema's object-level `.transform()`.

### Logging redactions

`apps/api/src/log.ts` configures pino with redacted paths for `phone`, `name`, `note`, `credentials`, `private_key`, and `GOOGLE_SERVICE_ACCOUNT_JSON_B64`. No request body is logged — only structured metadata (`request_id`, `idempotency_key`, `idempotent`, `sheets_latency_ms`, etc.). The `X-Request-Id` response header mirrors the log line's `request_id`.

### Web API base URL fallback

`apps/web/src/lib/api.ts` prefers `VITE_API_BASE_URL`, but falls back to a hardcoded Railway URL in prod (`PROD_API_FALLBACK`). This guards against a past incident where Railway built the bundle before the env var was set. In dev the base is empty and Vite's proxy handles `/api`.

## Conventions

- **TypeScript:** `tsconfig.base.json` sets `verbatimModuleSyntax: true` and `moduleResolution: Bundler`. Use `import type` for type-only imports. Cross-package imports use `.js` suffix (ESM resolution) — keep this for consistency.
- **Tailwind v4:** Avoid `[arbitrary]` brackets for sizing/spacing — use the dynamic spacing scale (e.g. `min-w-200` = 50rem). Brackets are OK for variant selectors and arbitrary CSS properties without a utility equivalent.
- **Russian-only:** UI strings, error messages, sheet headers, enum values are Russian. Phone numbers are `+7`-only by design.
- **Commits:** Conventional Commits 1.0.0 (`feat`, `fix`, `chore`, `refactor`, etc., optional scope). Description only — no body. No `Co-Authored-By` trailer.
- **Tests:** Vitest unit tests under `<package>/test/`. The Sheets client is mocked via `_setClientForTest()` and boot state via `_resetForTest()` — never make real Sheets calls in tests.

## Pitfalls

- **Don't write to row 1** — the sheet header lives there. `spreadsheets.values.append` with range `'Запись 2026'!A1` appends below the detected table; never use `values.update` on row 1.
- **Don't add per-request logging on boot-state short-circuit** — the startup line is the only signal by design.
- **Don't cache non-ok results in the idempotency map** — the route relies on `ok: true` being the only thing in the map and evicts anything else on hit.
- **Don't fix the `Ответсвенный` typo** without updating both the sheet and `EXPECTED_HEADERS` in the same change.
- **Don't switch to `RAW`** for the Sheets append — `USER_ENTERED` is what makes column H a number, column A a date, and columns I/J/K satisfy data validation.
