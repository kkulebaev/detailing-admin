# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile booking form for a detailing shop. One submission → one row appended to a fixed Google Sheet (`SPREADSHEET_ID`, tab `Запись 2026`) — Sheets is the source of truth for bookings. Postgres holds auxiliary data: `clients` (upserted by phone on each successful booking, best-effort), the pricelist (`sections` + `services`), and a structured `bookings` mirror. The `bookings` mirror is **stage 1 of migrating bookings off Sheets**: every booking is dual-written to Postgres best-effort alongside the authoritative Sheets append, and an in-app read-only list page renders it. Sheets stays the source of truth until a later cutover.

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

Postgres + seed (api package):

```bash
docker compose up -d postgres                          # local Postgres (port 5432)
pnpm --filter @detailing-admin/api db:generate         # regenerate migration after schema.ts change
pnpm --filter @detailing-admin/api db:migrate          # apply migrations against DATABASE_URL
pnpm --filter @detailing-admin/api db:studio           # drizzle studio
pnpm --filter @detailing-admin/api db:sync-prod        # mirror the prod DB into local (wipes local!)
pnpm --filter @detailing-admin/api seed:dump           # dump clients from Sheets → .seed/clients.json
pnpm --filter @detailing-admin/api seed:load           # upsert clients from .seed/clients.json
pnpm --filter @detailing-admin/api seed:pricelist      # load pricelist from .seed/pricelist.json
```

Local dev needs `apps/api/.env` (copy from `apps/api/.env.example`, supply `GOOGLE_SERVICE_ACCOUNT_JSON_B64`; `DATABASE_URL` already points at the docker-compose instance). API runs migrations automatically on boot. Web `.env.local` is optional — Vite dev server proxies `/api` to `localhost:3000` by default; override with `VITE_API_PROXY_TARGET` to point dev at a remote API.

### `db:sync-prod` — refresh local from prod

`pnpm --filter @detailing-admin/api db:sync-prod` (`apps/api/scripts/sync-prod-db.sh`) drops and recreates the **local** DB from a fresh `pg_dump` of prod, so local mirrors prod exactly. Prod is only read; the local DB is wiped (pass `--yes` to skip the confirmation). Both dump and restore run inside the local `postgres` container (streamed, no file on disk — historical client data never lands on your FS), so no host `pg_dump`/`psql` is needed (prod and local share the major version). After a sync, restart the API so it re-runs boot and flips `_dbReady`.

The prod connection string is **not** in the repo: put the **public** proxy URL (Railway → Postgres → Connect → Public Network — the `*.railway.internal` host does not resolve off-platform) in `apps/api/.env.prod` as `PROD_DATABASE_URL=…` (gitignored; template in `apps/api/.env.prod.example`), or pass it inline: `PROD_DATABASE_URL=… pnpm … db:sync-prod`. Rotating the prod password only means updating `.env.prod`.

## Architecture

pnpm workspace, three packages:

- **`packages/shared`** — single Zod schema (`bookingSchema`) is the wire contract. No build step; both apps import `.ts` directly via tsconfig path aliases (`@detailing-admin/shared/*` resolves to `packages/shared/src/*.ts`). Exports: schema, enums (`READINESS`, `MASTERS`), helpers (`normalizePhone`, `parseDdmmyyyy`), `bookingToRow`, `EXPECTED_HEADERS`, and the `ApiResult` discriminated union.
- **`apps/api`** — Hono on `@hono/node-server`. Routes: `POST /api/bookings`, `GET /api/clients`, `GET /api/pricelist`, `GET /healthz`. Sheets writes via `googleapis`; Postgres queries via Drizzle (`drizzle-orm` + `postgres-js`). Module-level state machine for boot health (see below).
- **`apps/web`** — Vue 3 + Vite + Tailwind v4 + shadcn-vue + vue-router. SPA wrapped by `AppLayout` + `AppSidebar`. Three pages: booking form (`/` → `BookingForm.vue`), clients list (`/clients` → `ClientsPage.vue`), pricelist table (`/pricelist` → `PricelistPage.vue`). The booking form uses `vee-validate` + `@vee-validate/zod` with the shared schema via `toTypedSchema(bookingSchema)`.

### Boot state machine (`apps/api/src/boot.ts`)

On startup `init()` calls `initDb()` (applies drizzle migrations against `DATABASE_URL`) and then `verifyHeaders()` (reads `A1:K1` from the sheet). `_bootState` ends up `'ok' | 'headers_mismatch' | 'not_configured'`. **It never calls `process.exit`** — the listener always binds. While `_bootState !== 'ok'`:
- `GET /healthz` and `POST /api/bookings` return HTTP 503 with the `unavailable` variant of `ApiResult`.
- The booking route short-circuits **before** validation, idempotency lookup, and any Sheets call — no per-request log line (the single `boot.headers.mismatch` / `boot.init.error` line at startup is the signal).
- Recovery requires a process restart after fixing the sheet (or updating `EXPECTED_HEADERS`).

DB readiness is tracked separately via `isDbReady()` (`_dbReady` flag). If migrations fail, `_dbReady` stays `false` but `_bootState` may still be `'ok'` — bookings continue to flow to Sheets while the best-effort DB side (client upsert **and** the `bookings` mirror insert) is silently skipped. Read routes that strictly require Postgres (`GET /api/bookings`, `/api/clients`, `/api/pricelist`, `/api/masters`) return 503 `unavailable` when `isDbReady()` is `false`. Never gate the booking **write** flow on DB readiness — Sheets is the source of truth; the `POST` mirror is additive and only the `GET` read is DB-gated.

This is deliberate: Railway treats a crash-loop as zero healthy revisions, hiding the root cause. A live listener returning structured 503s is observable.

### Bookings DB mirror (dual-write, stage 1)

`POST /api/bookings` writes to Sheets (authoritative) and then, best-effort, mirrors a structured row into the `bookings` table (`apps/api/src/db/bookings.ts`), reusing the same `if (isDbReady()) { … }` block as the client upsert. The mirror insert runs **after** a successful Sheets append and **never blocks the booking** — a DB failure logs `booking.db_mirror_failed` (or `booking.client_upsert_failed`) and the request still returns 201. Consequences:
- **Best-effort, not strict.** A Postgres outage means the row lands in Sheets but not the DB (drift), healed by a later backfill before cutover. This preserves the "never lose a booking" invariant.
- **No `status` column.** Because inserts only happen post-Sheets-success, every mirror row is already in Sheets; `sheetRow`/`sheetRange` link it back.
- **Durable idempotency.** `bookings.idempotencyKey` is `UNIQUE` and the insert is `onConflictDoNothing` — a post-TTL client retry (which re-appends to Sheets, pre-existing behavior) will not create a second mirror row.
- **Structured, not serialized.** Unlike the Sheets row, columns hold normalized values (phone in E.164, dates as `date`, amount as int) so the table can become the source of truth at cutover with minimal change. `bookingToDbRow()` maps the wire `Booking` → row (dates via `ddmmyyyyToIso`).
- **Read side.** `GET /api/bookings` is admin-only (the `/api/bookings/*` guard covers it) and read-only, with filters (date range, master, readiness), phone-normalized search, and limit/offset paging. The web page is `apps/web/src/components/BookingsPage.vue` at `/bookings`.

### `EXPECTED_HEADERS` is a byte-exact contract

`packages/shared/src/sheet-row.ts` pins the 11 header strings in column order (column K is `Ответственный`). The strings must match the target sheet's `A1:K1` byte-for-byte or the boot check fails — renaming a header on one side without the other, or pointing `SPREADSHEET_ID` at a sheet whose headers differ, trips `headers_mismatch`.

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

### UI primitives (shadcn-vue)

Base components live in `apps/web/src/components/ui/<name>/` — the full shadcn-vue registry is vendored in (accordion, alert, alert-dialog, button, calendar, card, command, dialog, drawer, dropdown-menu, form, input, popover, select, sheet, sidebar, table, tabs, toast/sonner, tooltip, … see the directory for the complete list). Each folder exports a barrel `index.ts`; import as `@/components/ui/<name>` (the `@` alias points at `apps/web/src/`). Config: `apps/web/components.json` — style `new-york`, base color `neutral`, CSS variables, icon library `lucide`, aliases `@/components`, `@/composables`, `@/lib/utils`, `@/components/ui`, `@/lib`.

## Conventions

- **TypeScript:** `tsconfig.base.json` sets `verbatimModuleSyntax: true` and `moduleResolution: Bundler`. Use `import type` for type-only imports. Cross-package imports use `.js` suffix (ESM resolution) — keep this for consistency.
- **Tailwind v4:** Avoid `[arbitrary]` brackets for sizing/spacing — use the dynamic spacing scale (e.g. `min-w-200` = 50rem). Brackets are OK for variant selectors and arbitrary CSS properties without a utility equivalent.
- **Russian-only:** UI strings, error messages, sheet headers, enum values are Russian. Phone numbers are `+7`-only by design.
- **Commits:** Conventional Commits 1.0.0 (`feat`, `fix`, `chore`, `refactor`, etc., optional scope). Description only — no body. No `Co-Authored-By` trailer.
- **Tests:** Vitest unit tests under `<package>/test/`. The Sheets client is mocked via `_setClientForTest()` and boot state via `_resetForTest()` / `_setDbReadyForTest()` — never make real Sheets or DB calls in tests.
- **Drizzle:** `drizzle.config.ts` has `casing: 'snake_case'` — write columns in camelCase TS (`sectionId`) and they map to `section_id` in SQL. Migrations live in `apps/api/drizzle/`; never hand-edit the generated SQL — change `schema.ts` and re-run `db:generate`. Migration files and `drizzle/meta/*` must be committed together.
- **Seed data:** `apps/api/.seed/` is gitignored (contains PII: client phones from historical sheets). The pricelist JSON also lives there and is intentionally outside git — regenerate it manually if a fresh checkout needs it. `seed:dump` regenerates `clients.json` from Sheets; there is no dump script for the pricelist.

## Pitfalls

- **Don't write to row 1** — the sheet header lives there. `spreadsheets.values.append` with range `'Запись 2026'!A1` appends below the detected table; never use `values.update` on row 1.
- **Don't add per-request logging on boot-state short-circuit** — the startup line is the only signal by design.
- **Don't cache non-ok results in the idempotency map** — the route relies on `ok: true` being the only thing in the map and evicts anything else on hit.
- **Don't rename a header** (e.g. column K `Ответственный`) without updating both the sheet and `EXPECTED_HEADERS` in the same change.
- **Don't switch to `RAW`** for the Sheets append — `USER_ENTERED` is what makes column H a number, column A a date, and columns I/J/K satisfy data validation.
- **Don't make the booking `POST` depend on Postgres.** Both the client upsert and the `bookings` mirror insert are best-effort; if the DB is down, the booking still goes to Sheets and returns 201. Only the read routes (`GET /api/bookings`, `/api/clients`, `/api/pricelist`, `/api/masters`) should consult `isDbReady()`.
- **Don't rewrite `input.value` while an IME composition is active.** Gboard on Android keeps a word in composition until a space/commit, and Vue's `v-model` refuses to touch the DOM while `el.composing` is set — so anything written programmatically lands in state only and the field keeps showing the typed prefix. Input masks (`onCarInput`, `onNameInput`, `onLicensePlateInput`, `ClientFormDialog.onPlateInput`) skip their turn on `InputEvent.isComposing` and re-mask on the closing `input`. Numeric fields are safe only because `inputmode="numeric"/"tel"/"decimal"` keeps the IME out. Prior art: `ui/command/CommandInput.vue`.
- **Don't close a suggestion list on `blur`, and don't select on `mousedown` alone.** The «Марка и модель» autocomplete suggests as you type, and on Android that only works because of three things: the list closes on pick/Escape/`pointer-down-outside` but *never* on `blur` (it arrived before the tap and tore the popover down); items are `<li role="option">` rather than `<button>`, so a tap doesn't steal focus; and selection is wired to both `mousedown.prevent` (keeps focus on desktop) and `click` (Chrome withholds emulated mouse events inside a pan-capable `overflow-auto` list). `selectCar` also re-`focus()`es the input — `PopoverContent` carries `tabindex="-1"` and can otherwise swallow the focus, killing the mobile keyboard. Popovers with a real trigger button (`ServicePicker`, `MasterMultiSelect`, the date pickers) have none of these problems — reka-ui drives them from real pointer events.
- **Don't commit anything from `apps/api/.seed/`.** The directory is gitignored on purpose (PII in `clients.json`; pricelist intentionally regenerated locally). If a fresh checkout needs the pricelist, regenerate `pricelist.json` from the source Sheets — there is no dump script for it.
