# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile-first admin panel for a detailing shop (UI brand: «Dazzle Detailing»). The core flow is the booking form: one submission → one row appended to a fixed Google Sheet (`SPREADSHEET_ID`, tab `Запись 2026`) — Sheets is the source of truth for **new** bookings. Around it the app manages, in Postgres: clients and their cars, the pricelist, masters, salaries (rates, hours, payouts), a structured `bookings` mirror, and revenue analytics. Access is behind login with two roles, `admin` and `employee`.

The `bookings` mirror is **stage 1 of migrating bookings off Sheets**: every booking is dual-written to Postgres best-effort alongside the authoritative Sheets append. Edits, deletes and readiness changes made in the app touch **only** Postgres (see «Bookings DB mirror» below).

## Commands

Node 24+, pnpm 11+ (`engines` / `packageManager` in the root `package.json`). Run from repo root:

```bash
pnpm install              # workspace install
pnpm dev                  # parallel: web (5173) + api (3000)
pnpm build                # vue-tsc + vite build (web); tsup (api)
pnpm test                 # vitest in all packages
pnpm typecheck            # tsc/vue-tsc --noEmit in all packages
pnpm lint                 # eslint over the whole workspace
```

A lefthook pre-commit hook runs `lint`, `typecheck` and `test` in parallel whenever a `.ts`/`.vue` file is staged. There is no CI — the hook is the gate.

Per-package (run from package dir or via `pnpm --filter`):

```bash
pnpm --filter @detailing-admin/api dev         # tsx watch
pnpm --filter @detailing-admin/api test        # vitest
pnpm --filter @detailing-admin/web typecheck   # vue-tsc -b --noEmit
pnpm --filter @detailing-admin/shared test     # vitest
```

Single test file: `pnpm --filter <pkg> exec vitest run path/to/file.test.ts`

API contract → web client (run after changing any route, request or response schema):

```bash
pnpm --filter @detailing-admin/api gen:openapi   # writes apps/web/openapi.json
pnpm --filter @detailing-admin/web gen:client    # orval → apps/web/src/lib/generated/
```

`apps/api/test/openapi-drift.test.ts` fails if the committed `openapi.json` is stale.

Postgres, seeds and maintenance (api package):

```bash
docker compose up -d postgres                          # local Postgres 18 (port 5432)
pnpm --filter @detailing-admin/api db:generate         # regenerate migration after schema.ts change
pnpm --filter @detailing-admin/api db:migrate          # apply migrations against DATABASE_URL
pnpm --filter @detailing-admin/api db:studio           # drizzle studio
pnpm --filter @detailing-admin/api db:sync-prod        # mirror the prod DB into local (wipes local!)
pnpm --filter @detailing-admin/api seed:dump           # dump clients from Sheets → .seed/clients.json
pnpm --filter @detailing-admin/api seed:load           # upsert clients from .seed/clients.json
pnpm --filter @detailing-admin/api seed:pricelist      # load pricelist from .seed/pricelist.json
pnpm --filter @detailing-admin/api seed:bookings-dev   # fake bookings for local dev
pnpm --filter @detailing-admin/api backfill:master-ids # heal booking_masters / responsibleId links
pnpm --filter @detailing-admin/api backfill:car-ids    # heal bookings.carId links
pnpm --filter @detailing-admin/api user:create --login <login> --role admin|employee
pnpm --filter @detailing-admin/api user:reset-password --login <login>
```

Local dev needs `apps/api/.env` (copy from `apps/api/.env.example`). Required: `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET` (≥32 chars); `DATABASE_URL` already points at the docker-compose instance. A missing/invalid required var makes `env.ts` throw at import — this is the one failure that does stop the process. API runs migrations automatically on boot. Accounts are created only via `user:create` (no self-registration); see `apps/api/AUTH.md`. Web `.env.local` is optional — Vite dev server proxies `/api` to `localhost:3000` by default; override with `VITE_API_PROXY_TARGET` to point dev at a remote API.

### `db:sync-prod` — refresh local from prod

`pnpm --filter @detailing-admin/api db:sync-prod` (`apps/api/scripts/sync-prod-db.sh`) drops and recreates the **local** DB from a fresh `pg_dump` of prod, so local mirrors prod exactly. Prod is only read; the local DB is wiped (pass `--yes` to skip the confirmation). Both dump and restore run inside the local `postgres` container (streamed, no file on disk — historical client data never lands on your FS), so no host `pg_dump`/`psql` is needed (prod and local share the major version). After a sync, restart the API so it re-runs boot and flips `_dbReady`.

The prod connection string is **not** in the repo: put the **public** proxy URL (Railway → Postgres → Connect → Public Network — the `*.railway.internal` host does not resolve off-platform) in `apps/api/.env.prod` as `PROD_DATABASE_URL=…` (gitignored; template in `apps/api/.env.prod.example`), or pass it inline: `PROD_DATABASE_URL=… pnpm … db:sync-prod`. Rotating the prod password only means updating `.env.prod`.

## Architecture

pnpm workspace, three packages:

- **`packages/shared`** — Zod schemas that form the wire contract for every route: `bookingSchema` plus the booking-row/list/mutation schemas, clients and cars, masters, pricelist, salaries, analytics, auth. No build step; both apps import `.ts` directly via tsconfig path aliases (`@detailing-admin/shared/*` resolves to `packages/shared/src/*.ts`). Also exports enums (`READINESS`), helpers (`normalizePhone`, `parseDdmmyyyy`, `ddmmyyyyToIso`, `toCsv`), `bookingToRow`, `EXPECTED_HEADERS`, `StatusCodes`, and the `ApiResult` discriminated union.
- **`apps/api`** — Hono via `@hono/zod-openapi` on `@hono/node-server`. Sheets writes via `googleapis`; Postgres via Drizzle (`drizzle-orm` + `postgres-js`); Telegram notifications via the Bot API (`telegram.ts`, `notify.ts`). Module-level state machine for boot health (see below). Routes (`apps/api/src/routes/`):
  - `/api/auth` — `login`, `logout`, `me` (GET/PATCH), `change-password`. Public; outside the guards.
  - `/api/bookings` — `POST` (booking form), `GET` list, `GET /export` (CSV), `PATCH /{id}`, `DELETE /{id}`, `PATCH /{id}/readiness`.
  - `/api/clients` — list, `GET /{id}` (detail with history), CRUD, `GET /export`.
  - `/api/pricelist` — `GET` plus CRUD for `sections` and `services`.
  - `/api/masters` — list, CRUD, `PATCH /reorder`. A master may be linked to a login account (`userId`).
  - `/api/salaries` — summary, `PATCH /rates`, `GET /entries`, CRUD for `hours` and `payouts`.
  - `/api/analytics/overview` — revenue totals, series, retention, top clients.
  - `/api/users` — login accounts, for the master form's account picker.
  - `/api/me` — the signed-in account's own hours: `GET /salary`, CRUD for `hours` (see «Self-service hours»).
  - `GET /healthz`, `GET /openapi.json`.
- **`apps/web`** — Vue 3 + Vite + Tailwind v4 + shadcn-vue + vue-router + Pinia (`stores/auth.ts`). SPA wrapped by `AppLayout` + `AppSidebar`. The API client is **orval-generated** from `apps/web/openapi.json` into `src/lib/generated/` (never hand-edit it); `src/lib/*-api.ts` wrap it. Pages (`src/router.ts`):
  - `/` booking form (`BookingForm.vue`, admin) — `vee-validate` + `@vee-validate/zod` with the shared schema via `toTypedSchema(bookingSchema)`; phone lookup autofills the client and their cars (`use-client-lookup`).
  - `/bookings` (`BookingsPage.vue`, admin + employee), `/clients` and `/clients/:id` (`ClientsPage.vue` — both paths mount the same instance so the detail dialog slides over the live list), `/pricelist`, `/masters`, `/salaries`, `/analytics` (admin).
  - `/employee` («Мои часы», `MyHoursPage.vue`), `/profile`, `/login` in `src/pages/`.

### Auth and roles

Stateless HS256 JWT in an httpOnly cookie (`apps/api/src/auth/`); `requireAuth` only verifies the token, so it never touches Postgres and the booking flow stays DB-independent. Guards are wired in `server.ts`:
- Everything under `/api` except `/api/auth` requires auth and is **admin-only**, with three exceptions open to any authenticated role: `GET /api/bookings*` and `GET /api/masters*` (the bookings handler hides amounts from non-admins), and `/api/me/*`, whose handlers scope everything to the caller's own master.
- The web router mirrors this with `meta.roles`; `homeRouteFor(role)` sends admins to `/` and employees to `/employee`.

Details, env vars and provisioning: `apps/api/AUTH.md`.

### Adding an API route

Register the router in **both** `apps/api/src/server.ts` and `apps/api/scripts/gen-openapi.ts` (the script builds its own route tree without booting Sheets/DB), add the guard in `server.ts`, then regenerate `openapi.json` and the orval client. Plain `router.get` handlers (the CSV exports) are not in the OpenAPI doc. A static path like `/export` must be registered **before** `/{id}` in the same router, or the `{id}` validator rejects it first.

### Boot state machine (`apps/api/src/boot.ts`)

On startup `init()` calls `initDb()` (applies drizzle migrations against `DATABASE_URL`) and then `verifyHeaders()` (reads `A1:K1` from the sheet). `_bootState` ends up `'ok' | 'headers_mismatch' | 'not_configured'`. **It never calls `process.exit`** — the listener always binds. While `_bootState !== 'ok'`:
- `GET /healthz` and `POST /api/bookings` return HTTP 503 with the `unavailable` variant of `ApiResult`.
- The booking route short-circuits **before** validation, idempotency lookup, and any Sheets call — no per-request log line (the single `boot.headers.mismatch` / `boot.init.error` line at startup is the signal).
- Recovery requires a process restart after fixing the sheet (or updating `EXPECTED_HEADERS`).

DB readiness is tracked separately via `isDbReady()` (`_dbReady` flag). If migrations fail, `_dbReady` stays `false` but `_bootState` may still be `'ok'` — bookings continue to flow to Sheets while the best-effort DB side (client/car upsert, the `bookings` mirror insert, master lookup for notifications) is silently skipped. Every route that is purely Postgres-backed — the bookings read/edit/delete/export, clients, pricelist, masters, salaries, analytics, and the DB-backed auth endpoints — returns 503 `unavailable` when `isDbReady()` is `false`. Never gate the booking **`POST`** on DB readiness — Sheets is the source of truth for new bookings.

This is deliberate: Railway treats a crash-loop as zero healthy revisions, hiding the root cause. A live listener returning structured 503s is observable.

### Bookings DB mirror (dual-write, stage 1)

`POST /api/bookings` writes to Sheets (authoritative) and then, best-effort, upserts the client and their car and mirrors a structured row into the `bookings` table (`apps/api/src/db/bookings.ts`), all inside one `if (isDbReady()) { … }` block. The mirror insert runs **after** a successful Sheets append and **never blocks the booking** — a DB failure logs `booking.db_mirror_failed` (or `booking.client_upsert_failed`) and the request still returns 201. Consequences:
- **Best-effort, not strict.** A Postgres outage means the row lands in Sheets but not the DB (drift), healed by a later backfill before cutover. This preserves the "never lose a booking" invariant.
- **No `status` column.** Because inserts only happen post-Sheets-success, every mirror row is already in Sheets; `sheetRow`/`sheetRange` link it back.
- **Durable idempotency.** `bookings.idempotencyKey` is `UNIQUE` and the insert is `onConflictDoNothing` — a post-TTL client retry (which re-appends to Sheets, pre-existing behavior) will not create a second mirror row.
- **Structured, not serialized.** Unlike the Sheets row, columns hold normalized values (phone in E.164, dates as `date`, amount as int) so the table can become the source of truth at cutover with minimal change. `bookingToDbRow()` maps the wire `Booking` → row (dates via `ddmmyyyyToIso`).
- **Snapshots plus derived id-links.** `master text[]`, `responsible` and `car` are the as-written snapshots; `booking_masters`, `responsibleId` and `carId` are derived links resolved by name/plate. The links are nullable, use `set null`/`cascade`, and are healed by the `backfill:*` scripts — a failed link step never fails the request.
- **Edits are DB-only.** `PATCH /{id}`, `DELETE /{id}` and `PATCH /{id}/readiness` change only the mirror; Sheets is not updated. After an in-app edit the mirror and the sheet disagree, which is a known gap until the cutover.
- **Read side.** `GET /api/bookings` has filters (date range, master, readiness), phone-normalized search, and limit/offset paging; `GET /api/bookings/export` streams the same selection as CSV. The web page is `apps/web/src/components/BookingsPage.vue` at `/bookings`.

### Telegram notifications

If the form sets `notify: true`, `notifyMaster()` sends a message to every assigned master whose `masters.telegramId` is set (chat ids resolved server-side by name, deduped). It never throws: the outcome rides back as `notification` in the `POST` response so the form can warn without failing the booking.

### Salaries

`master_rates` holds the current hourly rate (kept out of `masters`, whose `GET` is open to employees). Each `work_hours` row freezes `rateSnapshot` at insert so a rate change never rewrites past pay; time is stored as integer `minutes`. `payouts` are one-off amounts (negative = deduction, zero rejected by a DB check). Both history tables use `onDelete: 'restrict'`, and `deleteMaster()` refuses a master that has history.

### Self-service hours («Мои часы»)

An account is linked to at most one master via `masters.userId` (UNIQUE, set by the admin in `MasterFormDialog`). `/api/me` resolves that master from the session's `sub` on every request — the body never carries a `masterId`, and another master's record answers 404. The employee sees their own month (hours, rate, payouts, total) and may add, edit and delete **hours** only inside a rolling window of `SELF_EDIT_WINDOW_DAYS` (7) days ending today in `SHOP_TIMEZONE`; both the old and the new date of an edit must be inside it. Older days and payouts stay admin-only, so a month that may already be paid out can't shift. The server sends the window (`editableFrom`/`editableTo`) so the page never computes «today» itself.

### CSV export

`GET /api/bookings/export` and `GET /api/clients/export` return `text/csv` built by `toCsv` (shared): UTF-8 BOM, `;` separator, CRLF, RFC quoting, formula-injection sanitizing, capped at `EXPORT_CAP` rows. Amounts are included only for admins. The web side downloads via `src/lib/download.ts` (raw fetch → blob), not via the generated client.

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

### Web → API routing

`src/lib/api-base.ts` returns `VITE_API_BASE_URL` if set, otherwise `''` — requests stay **relative** (`/api/...`) in both dev and prod so the auth cookie is first-party (`SameSite=Lax`). In dev, Vite's `server.proxy` forwards `/api` to `VITE_API_PROXY_TARGET` (default `localhost:3000`). In prod the web container runs `vite preview`, whose `preview.proxy` forwards `/api` to the API service; `VITE_API_PROXY_TARGET` (Railway internal URL) is **required** there and `vite.config.ts` throws at startup without it — a silent localhost fallback once caused every `/api` call to 502. Setting `VITE_API_BASE_URL` to another origin makes the cookie third-party, which browsers drop.

### UI primitives (shadcn-vue)

Base components live in `apps/web/src/components/ui/<name>/` — the full shadcn-vue registry is vendored in (accordion, alert, alert-dialog, button, calendar, card, command, dialog, drawer, dropdown-menu, form, input, popover, select, sheet, sidebar, table, tabs, toast/sonner, tooltip, … see the directory for the complete list). Each folder exports a barrel `index.ts`; import as `@/components/ui/<name>` (the `@` alias points at `apps/web/src/`). Config: `apps/web/components.json` — style `new-york`, base color `neutral`, CSS variables, icon library `lucide`, aliases `@/components`, `@/composables`, `@/lib/utils`, `@/components/ui`, `@/lib`.

## Conventions

- **TypeScript:** `tsconfig.base.json` sets `verbatimModuleSyntax: true` and `moduleResolution: Bundler`. Use `import type` for type-only imports. Cross-package imports use `.js` suffix (ESM resolution) — keep this for consistency.
- **Typecheck the web app via `pnpm typecheck`** (it runs `vue-tsc -b --noEmit`). A bare `vue-tsc --noEmit` in `apps/web` checks nothing, because the root tsconfig only holds project references, so it always passes.
- **Tailwind v4:** Avoid `[arbitrary]` brackets for sizing/spacing — use the dynamic spacing scale (e.g. `min-w-200` = 50rem). Brackets are OK for variant selectors and arbitrary CSS properties without a utility equivalent.
- **Mobile-first layouts:** list pages render tables on wide screens and cards / collapsible sections on narrow ones. Keep both variants in sync when adding a column.
- **Russian-only:** UI strings, error messages, sheet headers, enum values are Russian. Phone numbers are `+7`-only by design.
- **Money is int:** amounts are whole rubles in `integer` columns; durations are integer minutes.
- **Commits:** Conventional Commits 1.0.0 (`feat`, `fix`, `chore`, `refactor`, etc., optional scope). Description only — no body. No `Co-Authored-By` trailer.
- **Tests:** Vitest unit tests under `<package>/test/`. The Sheets client is mocked via `_setClientForTest()` and boot state via `_resetForTest()` / `_setDbReadyForTest()` — never make real Sheets or DB calls in tests. reka-ui `Dialog` content is teleported, so in web component tests query it through `document`, not the mount wrapper.
- **Drizzle:** `drizzle.config.ts` has `casing: 'snake_case'` — write columns in camelCase TS (`sectionId`) and they map to `section_id` in SQL. Migrations live in `apps/api/drizzle/`; never hand-edit the generated SQL — change `schema.ts` and re-run `db:generate`. Migration files and `drizzle/meta/*` must be committed together.
- **Seed data:** `apps/api/.seed/` is gitignored (contains PII: client phones from historical sheets). The pricelist JSON also lives there and is intentionally outside git — regenerate it manually if a fresh checkout needs it. `seed:dump` regenerates `clients.json` from Sheets; there is no dump script for the pricelist.
- **Backlog:** `TODO.md` lists feature candidates with value/complexity notes; mark items `✅ Выполнено` with a status line when they ship.

## Pitfalls

- **Don't write to row 1** — the sheet header lives there. `spreadsheets.values.append` with range `'Запись 2026'!A1` appends below the detected table; never use `values.update` on row 1.
- **Don't add per-request logging on boot-state short-circuit** — the startup line is the only signal by design.
- **Don't cache non-ok results in the idempotency map** — the route relies on `ok: true` being the only thing in the map and evicts anything else on hit.
- **Don't rename a header** (e.g. column K `Ответственный`) without updating both the sheet and `EXPECTED_HEADERS` in the same change.
- **Don't switch to `RAW`** for the Sheets append — `USER_ENTERED` is what makes column H a number, column A a date, and columns I/J/K satisfy data validation.
- **Don't make the booking `POST` depend on Postgres.** The client/car upsert, the `bookings` mirror insert and the Telegram notification are best-effort; if the DB is down, the booking still goes to Sheets and returns 201. Only the Postgres-backed routes should consult `isDbReady()`.
- **Don't forget to regenerate the client.** A route or schema change without `gen:openapi` + `gen:client` still type-checks (the generated `unwrap()` casts), so only `openapi-drift.test.ts` catches it.
- **Don't put salary-sensitive columns on `masters`.** `GET /api/masters` is open to employees; rates live in `master_rates` for that reason.
- **Don't rewrite `input.value` while an IME composition is active.** Gboard on Android keeps a word in composition until a space/commit, and Vue's `v-model` refuses to touch the DOM while `el.composing` is set — so anything written programmatically lands in state only and the field keeps showing the typed prefix. Input masks (`onCarInput`, `onNameInput`, `onLicensePlateInput`, `ClientFormDialog.onPlateInput`) skip their turn on `InputEvent.isComposing` and re-mask on the closing `input`. Numeric fields are safe only because `inputmode="numeric"/"tel"/"decimal"` keeps the IME out. Prior art: `ui/command/CommandInput.vue`.
- **Select suggestions on `pointerup`, never on mouse events.** An event log from an emulated Pixel settles what the «Марка и модель» autocomplete has to do: a tap on a list item fires `pointerdown → mousedown → focusout → pointerup`, and `mouseup`/`click` never arrive at all, because the item is gone by the time they would. So the pick rides on `pointerup`; `pointerdown.prevent` keeps focus (and the mobile keyboard) in the field without blocking scroll, which `touch-action` governs; a drag beyond `CAR_TAP_SLOP_PX` scrolls instead of selecting; items are `<li>` rather than `<button>`; the list is a plain `absolute` element, not a `Popover` (`PopoverContent` has `tabindex="-1"` and steals focus); and it never closes on `blur` — that fired mid-tap. Closing is on pick, Escape, or a document `pointerdown` outside `[data-car-input]`/`[data-car-suggestions]`. Popovers with a real trigger button (`ServicePicker`, `MasterMultiSelect`, date pickers) need none of this — reka-ui handles it.
- **Don't commit anything from `apps/api/.seed/`.** The directory is gitignored on purpose (PII in `clients.json`; pricelist intentionally regenerated locally). If a fresh checkout needs the pricelist, regenerate `pricelist.json` from the source Sheets — there is no dump script for it.
