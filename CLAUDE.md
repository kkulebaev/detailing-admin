# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile-first admin panel for a detailing shop (UI brand: «Dazzle Detailing»). The core flow is the booking form: one submission → one row appended to a fixed Google Sheet (`SPREADSHEET_ID`, tab `Запись 2026`) — Sheets is the source of truth for **new** bookings. Around it the app manages, in Postgres: clients and their cars, the pricelist, masters, salaries (rates, hours, payouts), a structured `bookings` mirror, and revenue analytics. Access is behind login with three roles: `admin` (everything), `booker` (an employee who may also use the booking form and edit or delete bookings) and `employee`.

The `bookings` mirror is **stage 1 of migrating bookings off Sheets**: every booking is dual-written to Postgres best-effort alongside the authoritative Sheets append. Edits, deletes and readiness changes made in the app touch **only** Postgres (see «Bookings DB mirror» below).

## Commands

Node 26+, pnpm 12+ (`engines` / `packageManager` in the root `package.json`). Run from repo root:

```bash
pnpm install              # workspace install
pnpm dev                  # parallel: web (5173) + api (3000)
pnpm build                # vue-tsc + vite build (web); tsup (api)
pnpm test                 # vitest in all packages
pnpm typecheck            # tsc/vue-tsc --noEmit in all packages
pnpm lint                 # eslint over the whole workspace
pnpm fmt                  # oxfmt, rewrites files (`pnpm fmt:check` only reports)
pnpm test:e2e             # Playwright, not part of the hook (needs docker compose postgres)
```

A lefthook pre-commit hook runs `lint`, `fmt:check`, `typecheck` and `test` in parallel whenever a `.ts`/`.vue` file is staged (`fmt:check` also on other formatted file types). There is no CI — the hook is the gate.

Web tests run in Chromium, so after the first install run `pnpm --filter @detailing-admin/web exec playwright install --only-shell chromium` once; without it neither `pnpm test` nor the hook passes.

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
pnpm --filter @detailing-admin/api db:backup           # pg_dump prod (or BACKUP_DATABASE_URL) → apps/api/.backups/ (PII, gitignored)
pnpm --filter @detailing-admin/api seed:dump           # dump clients from Sheets → .seed/clients.json
pnpm --filter @detailing-admin/api seed:load           # upsert clients from .seed/clients.json
pnpm --filter @detailing-admin/api seed:pricelist      # load pricelist from .seed/pricelist.json
pnpm --filter @detailing-admin/api seed:bookings-dev   # fake bookings for local dev
pnpm --filter @detailing-admin/api backfill:master-ids # heal booking_masters / responsibleId links
pnpm --filter @detailing-admin/api backfill:car-ids    # heal bookings.carId links
pnpm --filter @detailing-admin/api backfill:booking-services  # dry-run; --apply splits old service text into booking_services
pnpm --filter @detailing-admin/api user:create --login <login> --role admin|booker|employee
pnpm --filter @detailing-admin/api user:set-role --login <login> --role admin|booker|employee
pnpm --filter @detailing-admin/api user:reset-password --login <login>
pnpm --filter @detailing-admin/api push:gen-vapid     # one-time VAPID key pair for Web Push (keep the private key out of the transcript and git)
```

Local dev needs `apps/api/.env` (copy from `apps/api/.env.example`). Required: `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET` (≥32 chars); `DATABASE_URL` already points at the docker-compose instance. A missing/invalid required var makes `env.ts` throw at import — this is the one failure that does stop the process. Optional: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (all three or none; without them Web Push is off, a partial set or a `VAPID_SUBJECT` that is not `mailto:`/`https:` fails `env.ts`) and `TELEGRAM_POLLING` (default `false`; set `true` only where this bot should answer `/start` — dev and prod use different bots). API runs migrations automatically on boot. Accounts are created only via `user:create` (no self-registration); see `apps/api/AUTH.md`. Web `.env.local` is optional — Vite dev server proxies `/api` to `localhost:3000` by default; override with `VITE_API_PROXY_TARGET` to point dev at a remote API.

### E2E tests

`pnpm test:e2e` (`apps/web/playwright.config.ts`, specs in `apps/web/e2e/`) drives a phone-sized Chromium against the real API and Vite on their own ports (3100, 5174), so `pnpm dev` can stay up. `apps/api/e2e/server.ts` recreates the `detailing_e2e` database on every start, seeds it, and replaces only Sheets, Telegram and the Web Push sender with in-memory fakes; it sets all env itself and never reads `.env`, so a run can't reach the real spreadsheet, bot or the `detailing` database. Specs read what reached the fakes through `GET /__e2e/state` and feed the bot a fake update through `POST /__e2e/telegram/update` (the Telegram poller never starts there); both exist only in that entry point. Seeded logins: `e2e-admin`, `e2e-booker`, `e2e-employee`.

### `db:sync-prod` — refresh local from prod

`pnpm --filter @detailing-admin/api db:sync-prod` (`apps/api/scripts/sync-prod-db.sh`) drops and recreates the **local** DB from a fresh `pg_dump` of prod, so local mirrors prod exactly. Prod is only read; the local DB is wiped (pass `--yes` to skip the confirmation). Both dump and restore run inside the local `postgres` container (streamed, no file on disk — historical client data never lands on your FS), so no host `pg_dump`/`psql` is needed (prod and local share the major version). After a sync, restart the API so it re-runs boot and flips `_dbReady`. The script also empties `push_subscriptions` and `telegram_link_tokens` and nulls `users.telegram_chat_id`, so a local API never pushes or writes to prod users.

The prod connection string is **not** in the repo: put the **public** proxy URL (Railway → Postgres → Connect → Public Network — the `*.railway.internal` host does not resolve off-platform) in `apps/api/.env.prod` as `PROD_DATABASE_URL=…` (gitignored; template in `apps/api/.env.prod.example`), or pass it inline: `PROD_DATABASE_URL=… pnpm … db:sync-prod`. Rotating the prod password only means updating `.env.prod`.

## Architecture

pnpm workspace, three packages:

- **`packages/shared`** — Zod schemas that form the wire contract for every route: `bookingSchema` plus the booking-row/list/mutation schemas, clients and cars, masters, pricelist, salaries, analytics, auth. No build step; both apps import `.ts` directly via tsconfig path aliases (`@detailing-admin/shared/*` resolves to `packages/shared/src/*.ts`). Also exports enums (`READINESS`), helpers (`normalizePhone`, `parseDdmmyyyy`, `ddmmyyyyToIso`, `toCsv`), `bookingToRow`, `EXPECTED_HEADERS`, `StatusCodes`, and the `ApiResult` discriminated union.
- **`apps/api`** — Hono via `@hono/zod-openapi` on `@hono/node-server`. Sheets writes via `googleapis`; Postgres via Drizzle (`drizzle-orm` + `postgres-js`); Telegram notifications via the Bot API (`telegram.ts`, `notifications/`). Module-level state machine for boot health (see below). Routes (`apps/api/src/routes/`):
  - `/api/auth` — `login`, `logout`, `me` (GET/PATCH), `change-password`. Public; outside the guards.
  - `/api/bookings` — `POST` (booking form), `GET` list, `GET /export` (CSV), `PATCH /{id}`, `DELETE /{id}`, `PATCH /{id}/readiness`; admin-only `GET /{id}/history`, `GET /journal`, `GET /deleted`, `POST /{id}/restore` (see «Booking audit log»).
  - `/api/clients` — list, `GET /{id}` (detail with history), CRUD, `GET /export`.
  - `/api/pricelist` — `GET` plus CRUD for `sections` and `services`.
  - `/api/masters` — list, CRUD, `PATCH /reorder`. A master may be linked to a login account (`userId`).
  - `/api/salaries` — summary, `PATCH /rates`, `GET /entries`, CRUD for `hours` and `payouts`; `GET /work-rules` and `PUT /work-rules/{masterId}` (see «Masters' work rules»).
  - `/api/analytics/overview` — revenue totals, series, retention, top clients.
  - `/api/users` — login accounts, for the master form's account picker.
  - `/api/me` — the signed-in account's own hours: `GET /salary`, CRUD for `hours` (see «Self-service hours»), plus own schedule requests under `/schedule-requests`.
  - `/api/schedule` — masters' working days: `GET ?from&to`, `PATCH` a batch of days (see «Masters' schedule»); studio hours `GET`/`PUT /studio-hours` (see «Studio hours»).
  - `/api/schedule-requests` — admin review of employees' schedule requests: `GET` pending, `POST /{id}/approve`, `POST /{id}/reject`; employees submit via `/api/me/schedule-requests` (`GET`, `POST`, `DELETE /{id}`).
  - `/api/notifications` — the caller's own feed: `GET` (cursor `before`), `GET /unread-count`, `POST /read-all`, `POST /{id}/read`, `POST /{id}/unread`; Web Push `GET /push/config`, `POST`/`DELETE /push/subscriptions`, `POST /push/subscriptions/current`; Telegram `GET`/`DELETE /telegram`, `POST /telegram/link` (see «Notifications»).
  - `GET /healthz`, `GET /openapi.json`.
- **`apps/web`** — Vue 3 + Vite + Tailwind v4 + shadcn-vue + vue-router + Pinia (`stores/auth.ts`). SPA wrapped by `AppLayout` + `AppSidebar`. The API client is **orval-generated** from `apps/web/openapi.json` into `src/lib/generated/` (never hand-edit it); `src/lib/*-api.ts` wrap it. Pages (`src/router.ts`):
  - `/` booking form (`BookingForm.vue`, admin + booker) — `vee-validate` + `@vee-validate/zod` with the shared schema via `toTypedSchema(bookingSchema)`; phone lookup autofills the client and their cars (`use-client-lookup`).
  - `/bookings` (`BookingsPage.vue`, all roles), `/clients` and `/clients/:id` (`ClientsPage.vue` — both paths mount the same instance so the detail dialog slides over the live list), `/pricelist`, `/masters`, `/salaries`, `/analytics` (admin), `/schedule` (`SchedulePage.vue`, all roles, only admins edit).
  - `/employee` («Мои часы», `MyHoursPage.vue`), `/notifications` (`NotificationsPage.vue`, all roles; linked from the sidebar footer with an unread counter), `/profile` (push and Telegram switches in `NotificationSettingsCard`), `/login` in `src/pages/`.

### Auth and roles

Stateless HS256 JWT in an httpOnly cookie (`apps/api/src/auth/`); `requireAuth` only verifies the token, so it never touches Postgres and the booking flow stays DB-independent. Guards are wired in `server.ts`:
- Everything under `/api` except `/api/auth` requires auth and is **admin-only**, with five exceptions open to any authenticated role: `GET /api/bookings*` (the handler hides amounts from `employee`), `GET /api/masters*`, `GET /api/schedule*`, `/api/me/*`, whose handlers scope everything to the caller's own master, and `/api/notifications/*`, scoped to the caller's own account (`sub`).
- The booking audit endpoints (`/api/bookings/deleted`, `/journal`, `/{id}/history`, `/{id}/restore`) are admin-only despite their `GET`/`POST` methods: `BOOKINGS_ADMIN_ONLY` in `server.ts` matches them before the per-method branches.
- `booker` additionally gets what the booking form needs: `POST /api/bookings`, `GET /api/pricelist` and `GET /api/clients/lookup` (exact phone only, no `totalSpent`), plus editing bookings: `PATCH /api/bookings/{id}`, `DELETE /api/bookings/{id}` and `PATCH /api/bookings/{id}/readiness`. The clients list, card and export stay admin-only.
- The rules live in `canCreateBookings` / `canEditBookings` / `canSeeAmounts` (shared). `toRole` narrows `users.role`, which is a plain varchar, so an unknown value becomes `employee`.
- The role is a JWT claim and `/me` re-mints it from the old token, so `user:set-role` reaches a live session only after a fresh login.
- The web router mirrors this with `meta.roles`; `homeRouteFor(role)` sends admins and bookers to `/`, employees to `/employee`.

Details, env vars and provisioning: `apps/api/AUTH.md`.

### Adding an API route

Register the router in **both** `apps/api/src/server.ts` and `apps/api/scripts/gen-openapi.ts` (the script builds its own route tree without booting Sheets/DB), add the guard in `server.ts`, then regenerate `openapi.json` and the orval client. Plain `router.get` handlers (the CSV exports) are not in the OpenAPI doc. A static path like `/export` must be registered **before** `/{id}` in the same router, or the `{id}` validator rejects it first.

### Boot state machine (`apps/api/src/boot.ts`)

On startup `init()` calls `initDb()` (applies drizzle migrations against `DATABASE_URL`) and then `verifyHeaders()` (reads `A1:K1` from the sheet). `_bootState` ends up `'ok' | 'headers_mismatch' | 'not_configured'`. **It never calls `process.exit`** — the listener always binds. While `_bootState !== 'ok'`:
- `GET /healthz` and `POST /api/bookings` return HTTP 503 with the `unavailable` variant of `ApiResult`.
- The booking route short-circuits **before** validation, idempotency lookup, and any Sheets call — no per-request log line (the single `boot.headers.mismatch` / `boot.init.error` line at startup is the signal).
- Recovery requires a process restart after fixing the sheet (or updating `EXPECTED_HEADERS`).

DB readiness is tracked separately via `isDbReady()` (`_dbReady` flag). If migrations fail, `_dbReady` stays `false` but `_bootState` may still be `'ok'` — bookings continue to flow to Sheets while the best-effort DB side (client/car upsert, the `bookings` mirror insert and the masters' notifications written with it) is silently skipped. Every route that is purely Postgres-backed — the bookings read/edit/delete/export, clients, pricelist, masters, salaries, analytics, and the DB-backed auth endpoints — returns 503 `unavailable` when `isDbReady()` is `false`. Never gate the booking **`POST`** on DB readiness — Sheets is the source of truth for new bookings.

This is deliberate: Railway treats a crash-loop as zero healthy revisions, hiding the root cause. A live listener returning structured 503s is observable.

### Bookings DB mirror (dual-write, stage 1)

`POST /api/bookings` writes to Sheets (authoritative) and then, best-effort, upserts the client and their car and mirrors a structured row into the `bookings` table (`apps/api/src/db/bookings.ts`), all inside one `if (isDbReady()) { … }` block. The mirror insert runs **after** a successful Sheets append and **never blocks the booking** — a DB failure logs `booking.db_mirror_failed` (or `booking.client_upsert_failed`) and the request still returns 201. Consequences:
- **Best-effort, not strict.** A Postgres outage means the row lands in Sheets but not the DB (drift), healed by a later backfill before cutover. This preserves the "never lose a booking" invariant.
- **No `status` column.** Because inserts only happen post-Sheets-success, every mirror row is already in Sheets; `sheetRow`/`sheetRange` link it back.
- **Durable idempotency.** `bookings.idempotencyKey` is `UNIQUE` and the insert is `onConflictDoNothing` — a post-TTL client retry (which re-appends to Sheets, pre-existing behavior) will not create a second mirror row.
- **Structured, not serialized.** Unlike the Sheets row, columns hold normalized values (phone in E.164, dates as `date`, amount as int) so the table can become the source of truth at cutover with minimal change. `bookingToDbRow()` maps the wire `Booking` → row (dates via `ddmmyyyyToIso`).
- **Snapshots plus derived id-links.** `master text[]`, `responsible` and `car` are the as-written snapshots; `booking_masters`, `responsibleId` and `carId` are derived links resolved by name/plate. The links are nullable, use `set null`/`cascade`, and are healed by the `backfill:*` scripts — a failed link step never fails the request.
- **Services are lines.** `booking_services` holds one row per picked service in `position` order: `section`, `name` and unit `price` are snapshots (the price may have been edited in the form), `quantity` ≥ 1, `serviceId` is a derived link (`set null` when the service leaves the pricelist; an unknown id becomes `null` on write instead of failing the FK). `bookings.service` stays the text sent to the sheet, and `bookings.discount` is the ruble discount already subtracted from `amount`. The wire `services`/`discount` are optional: on `PATCH`, omitting `services` keeps the stored lines and `[]` clears them; omitting `discount` keeps it. Lines carry prices, so reads include them only for roles that see amounts. Lines and `discount` are not audited fields: a line edit shows in history through `service` and `amountFormula`, which the edit dialog rebuilds only after the user touches the picker (until then it sends neither `services` nor a new text, so a renamed pricelist entry doesn't rewrite the booking). A delete snapshot keeps the lines and restore re-inserts them. Older bookings have no lines: `BookingEditDialog` edits them as text until «Выбрать из прайса»; `backfill:booking-services` fills lines only where the service cell and `amountFormula` parse unambiguously and add up to `amount` (run `db:backup` first; it skips bookings whose `service` was edited in the app, since such an edit could keep a stale formula, and prints rollback SQL that leaves alone bookings changed after the run).
- **Edits are DB-only.** `PATCH /{id}`, `DELETE /{id}`, `PATCH /{id}/readiness` and `POST /{id}/restore` change only the mirror; Sheets is not updated. After an in-app edit the mirror and the sheet disagree, which is a known gap until the cutover.
- **Read side.** `GET /api/bookings` has filters (date range, master, readiness), phone-normalized search, and limit/offset paging; `GET /api/bookings/export` streams the same selection as CSV. The web page is `apps/web/src/components/BookingsPage.vue` at `/bookings`.

### Booking audit log

`audit_log` records who created, edited, deleted and restored each booking (`apps/api/src/db/audit.ts`, `db/bookings.ts`). Every mutation in `db/bookings.ts` takes an `AuditActor` (snapshot of the session's id, login and name) and writes its row in the **same transaction** as the change, locking the booking with `SELECT … FOR UPDATE` first so the «before» values are exact. An edit stores only the changed fields (`diffBookings` over `BOOKING_AUDITED_FIELDS`); a no-op save writes nothing. Derived links (`clientId`, `carId`, `responsibleId`) are not audited.
- **Delete stays physical.** The full row plus its `booking_masters` links goes into `audit_log.snapshot`, so a deleted booking never leaks into any `bookings` read (list, analytics, client totals, FK checks) — there is deliberately no `deletedAt` column. Don't add one.
- **Restore** re-inserts the latest snapshot with the same id; a client, car or master that disappeared meanwhile becomes a `null` link (snapshots stay). A second restore is a 409 `already_restored`.
- **The journal** (`GET /api/bookings/journal`) is every entry across all bookings, newest first, with a booking summary (from the live row, or the latest delete snapshot when the booking is gone) and a `deleted` flag, optionally filtered by `actorId` and `action`. It pages by `limit` + `hasMore` (`limit` up to 500); the web grows `limit` instead of moving `offset`, so a fresh event can't shift pages and duplicate a row.
- **The trash** (`GET /api/bookings/deleted`) is the latest `delete` entry per id whose booking is currently absent, newest first, capped at 100.
- History starts with the migration: older bookings have no `create` entry. `POST /api/bookings` logs `create` only when the mirror insert happens; seed scripts pass no actor and log nothing.
- Like other in-app edits, none of this reaches Sheets.
- **Author (`createdBy`)** is read from the `create` entry on every bookings read (`enrichForRead` in `db/bookings.ts`), not stored on `bookings`, so it survives delete + restore. It reaches every role, but the bookings table has no column for it: it shows in the row tooltip, as the `create` event at the bottom of the booking history and in the CSV export; `null` for bookings older than the log.
- Booking history always ends with creation: for a booking older than the log, `BookingHistory` synthesizes a `create` event from `createdAt` with no author.
- Web: «История изменений» in `BookingDetailsDialog` (in the full table admins open it with the history button in «Действия»), the «Журнал» dialog (`BookingJournalDialog`) and the «Удаленные» dialog (`DeletedBookingsDialog`) on `/bookings`, all admin-only.

### Notifications

Per-account feed plus two outbound channels (Web Push, Telegram); code in `apps/api/src/notifications/`, types and the channel policy in `packages/shared/src/notifications.ts`.
- **Events and recipients** (`events.ts`, pure functions): `booking.assigned`/`changed`/`unassigned` go to the accounts of the masters added, kept or removed (`masters.userId`, any role — an admin linked to a master gets them too); `schedule_request.created` to every admin; `schedule_request.decided` to the account linked to the master **at decision time**; `payout.changed` and `work_hours.changed` to the master's account, only for admin edits through `/api/salaries` (self-service hours via `/api/me` never notify). The actor never gets a notification about their own action, a master without an account gets none, and seed scripts (no actor) create none. `booking.changed` fires only on `dateFrom/dateTo/time/timeTo/car/service`; readiness and amount don't.
- **Master diff is by id.** «Before» is the union of `booking_masters` and the snapshot names resolved now (old bookings lack links); «after» is the ids resolved before the transaction. Comparing names would send a false «removed» + «assigned» after a master is renamed. `booking_masters` is rewritten **inside** the mutation's transaction (savepoint) so a concurrent edit reads fresh links.
- **Written in the same transaction, behind a savepoint.** `insertNotifications(tx, build)` runs recipient lookup and insert inside `tx.transaction(...)` and swallows its own failure (`notification.insert_failed`): the feed is atomic with the change, but a notification bug never rolls back a booking, payout or decision. The salaries handlers open that transaction themselves (the `db/salaries.ts` functions take an optional `tx`).
- **Delivery is after commit, fire-and-forget** (`deliver.ts`), and `notification_deliveries` (PK `notificationId` + `channel`) is the outbox: a channel is claimed with `INSERT … ON CONFLICT DO NOTHING` before sending, so the post-commit call and the sweeper never double-send. A claim is released only when the whole channel failed (DB error, no response from Telegram, Telegram 429/5xx — then the channel also pauses for `retry_after`); a push-service 5xx/429 or a Telegram 400/403 counts as a final attempt. The sweeper (from `main.ts`, every minute) resends rows 10 s – 15 min old that lack a claim on a channel that applies to the type and is connected for the user; older ones stay feed-only. SIGTERM gives in-flight deliveries 3 s.
- **Channel policy is one table**, `NOTIFICATION_CHANNELS`: every type, `booking.*` included, goes to the feed, push and Telegram. A type left out of a channel there is never sent to it, neither after commit nor by the sweeper. There is no per-booking opt-out: the booking form has no «notify» switch, and the old `notify` / `notification` fields of `POST /api/bookings` are gone (an old client that still sends `notify` gets it stripped, since the schemas are not strict).
- **Texts are snapshots** (`title`, `body`). `pushBody ?? body` is the lock-screen / Telegram text: for `booking.*` it has no client name or phone, and no booking notification carries amounts.
- **Notifications lead nowhere.** `events.ts` still fills `notifications.link` (a booking's `/bookings?booking=<id>`, money to `/employee` or `/salaries`) and the feed API returns it, but neither the feed nor any channel uses it now: it stays in the schema in case links come back. `/bookings?booking=<id>` itself still opens a booking's dialog regardless of list filters via `GET /api/bookings/{id}`.
- **Categories** (`notification-view.ts`): every type maps to one of «Записи», «График», «Выплаты», «Часы» through an exhaustive `Record`, and each category has exactly one icon and color (a deduction, told by the minus that starts a `payout.changed` body, keeps the «Выплаты» icon in rose); the dialog names the category next to the date.
- **Feed:** `ORDER BY id DESC` with a `before=id` cursor (`now()` is equal inside one transaction); a tap on a row opens `NotificationDialog` (category icon and tone, title, the full `body` with line breaks, the full date and time) and never navigates; opening an unread one marks it read (`POST /{id}/read`, not sent when already read); the dialog has no buttons besides its close cross. A left swipe on a row reveals one action behind it, as in iOS Mail: «Не прочитано» (`Mail`, `POST /{id}/unread`) on a read row, «Прочитано» (`MailOpen`, `POST /{id}/read`) on an unread one (both own-only, someone else's id is a 404). Tapping the action runs it, releasing past 60% of the row width runs it at once, tapping the open row only closes it, and any `pointerdown` outside that row (another row's swipe too) closes it, so one is open at most. The swipe is hand-written on pointer events in `NotificationItem.vue`: `touch-pan-y` keeps vertical scroll, a gesture becomes horizontal only past 8 px with `|dx| > |dy|`, and `setPointerCapture` is taken only then (captured on a plain tap, the `click` would go to the container instead of the row button); a `click` that follows a swipe is swallowed. The gesture has a keyboard and screen-reader twin: an `sr-only` button «Отметить прочитанным: …» / «Отметить непрочитанным: …» that shows on `focus-visible`, while the swipe action itself is `aria-hidden`. The main area, the action and that button are siblings, never a button inside a button; both marks are optimistic, roll back with a toast on failure and invalidate the unread counter's query; «Прочитать все» marks the rest; `cleanup.ts` deletes notifications older than `NOTIFICATION_RETENTION_DAYS` (90) and expired link tokens (spent ones stay until their 10 minutes run out: «Уже подключено» needs them) at start and daily (timers `unref()`, skipped while the DB is not ready).
- **Web Push:** optional VAPID env (none → `push/config` returns `publicKey: null` and the profile says push is not configured). Subscriptions are upserted by endpoint, so the endpoint moves to whoever subscribed last on that device; endpoints must be https on an allowlisted push host (`PUSH_SERVICE_HOSTS`, SSRF guard); 404/410 deletes the row. The payload's `link` is always `/notifications` (set in `deliver.ts`, so already installed workers need no change), so a tap on a push opens the feed; it carries `unread` for `setAppBadge`; TTL 24 h, `Topic` = tag. `apps/web/public/sw.js` is hand-written with **no `fetch` handler and no precache** (so a deploy can never be pinned to stale chunks); it only shows notifications and routes clicks to same-origin paths. nginx serves `/sw.js` with `try_files $uri =404` and `no-cache`; it is registered with `updateViaCache: 'none'`, and the click listener lives in `main.ts` so it works on `/login` too. Permission is asked only on a tap (iOS requires it); on iOS outside the installed PWA the card shows an «add to Home Screen» hint instead. Logout only detaches the device: it deletes the server row while the session is alive (`detachPushSubscription`) but keeps the browser subscription, because iOS allows `pushManager.subscribe()` only on a gesture while re-sending an existing subscription needs none; the profile switch turning off is the full unsubscribe (server row, browser subscription and intent). The intent is per account on the device: `localStorage` key `push-intent:<login>`, set by a successful switch-on, cleared by switch-off, kept by logout. After login and after `fetchMe()` on every app start, `syncPushSubscription` re-POSTs the existing subscription (never `subscribe()`, never a prompt, never throws, not awaited) when permission is `granted` and this account's key is set, so the endpoint moves back to this account and a rotated endpoint reaches the server; without the key it does nothing, so another person on a shared phone never inherits pushes. The profile's status call waits for an in-flight sync. Each row has `expiresAt` = the saving session's JWT `exp` (re-stamped by every sync, and `/me` re-mints the token), so a device whose session ran out stops getting pushes: delivery, the sweeper's «connected» check and `POST /push/subscriptions/current` treat a row as live only while `expiresAt > now()`, and the daily cleanup deletes expired rows. The column is `NOT NULL DEFAULT now()` only so the migration could add it: rows saved before it count as expired at once.
- **Telegram:** `users.telegramChatId` (UNIQUE) is the only chat id: per account, so a master gets Telegram only through the account linked to them (`masters.userId`). Linking is a deep link `t.me/<bot>?start=<token>`; `telegram_link_tokens` keeps only a sha256, lives 10 min and is spent atomically (`used_at`). The bot answers «Подключено», «Уже подключено» (only for the chat already linked to that token's account), «Ссылка устарела», and warns when a chat moves over from another account. Updates arrive by **long polling** (`telegram-poller.ts`, started from `main.ts` after `serve()`, never from `init()`, only with `TELEGRAM_POLLING=true` and a ready DB). On every Railway deploy the old and new containers poll at once, so a 409 is normal (backoff, `debug`); a 409 that mentions a webhook logs one `telegram.poll.webhook_active` warn. The offset is confirmed right after handling and once more on stop. A 403 from `sendMessage` unlinks that chat. A message is the bold title and the text, with no link. Logs never carry message text, chat ids or tokens.
- **Tests** never reach the network: `test/setup.ts` clears `VAPID_*`, sets `TELEGRAM_POLLING=false` and mocks `web-push.sendNotification` to throw; senders are swapped via `_setPushSenderForTest` and `telegram.ts`'s `_setFetchForTest`.

### Salaries

`master_rates` holds the current hourly rate (kept out of `masters`, whose `GET` is open to employees). Each `work_hours` row freezes `rateSnapshot` at insert so a rate change never rewrites past pay; time is stored as integer `minutes`. `payouts` are one-off amounts (negative = deduction, zero rejected by a DB check). Both history tables use `onDelete: 'restrict'`.

### Masters' work rules

`master_work_rules` says what a master may be assigned to and what they earn for it: one row per master and target, where the target is either a whole pricelist section or a single service (exactly one, a CHECK), and the pay is either `percent` (integer 0–100) or `fixed` rubles per unit with one amount per car class I–IV (`fixedClass1..4`, all required, 0 allowed). A service rule overrides its section's rule; a service with neither is off-limits for that master. The routes live under `/api/salaries`, not `/api/masters`, because every `GET /api/masters*` is open to employees and the rules carry pay. `PUT /work-rules/{masterId}` replaces the master's whole list in one transaction (an archived master is a 404, a section or service that left the pricelist is a 400 pointing at `['rules', i, …]`). Edited on `/masters` via «Виды работ» (`MasterWorkRulesDialog`). The FKs cascade: rules are current settings, not money history. This is stage 1 of per-service pay: bookings don't use the rules yet.

### Service duration

`services.durationMinutes` is the work time of one service: one value for all car classes (unlike prices), per unit for a `countable` service, `NULL` while not set (every service older than the column starts that way; to become `NOT NULL` once prod is filled in, see `TODO.md` 8.1). The wire value is integer minutes, 1 … `MAX_SERVICE_DURATION_MINUTES` (200 h); `ServiceFormDialog` edits it in whole hours only (empty means `null`); minutes stay on the wire so finer steps need no migration, and `/pricelist` shows it via `formatServiceDuration`. Nothing reads it yet: it is groundwork for computing a booking's end date from its services and a master's load per day in the schedule.

### Deleting a master is archiving

`DELETE /api/masters/{id}` never removes the row: `deleteMaster()` sets `masters.archived` and clears `userId`, so bookings and pay history keep their links and the account can be attached elsewhere. There is no API or UI to restore; that is a manual `UPDATE` in the database. Archived masters are absent from `GET /api/masters`, and `updateMaster`/`reorderMasters` ignore them, so they vanish from every picker and from the `/bookings` filter. Two places still show them on purpose: a booking that already names them, and the salaries summary in months where they have hours or payouts, so money owed for the last month isn't hidden. The name stays taken (UNIQUE), which surfaces as the `archived_name` conflict.

### Self-service hours («Мои часы»)

An account is linked to at most one master via `masters.userId` (UNIQUE, set by the admin in `MasterFormDialog`). `/api/me` resolves that master from the session's `sub` on every request — the body never carries a `masterId`, and another master's record answers 404. The employee sees their own month (hours, rate, payouts, total) and may add, edit and delete **hours** only inside a rolling window of `SELF_EDIT_WINDOW_DAYS` (7) days ending today in `SHOP_TIMEZONE`; both the old and the new date of an edit must be inside it. Older days and payouts stay admin-only, so a month that may already be paid out can't shift. The server sends the window (`editableFrom`/`editableTo`) so the page never computes «today» itself.

### Masters' schedule

`master_schedule` stores **only working days** (`masterId` + `workDate`, composite PK, `cascade`); a missing row is a day off. `GET /api/schedule?from&to` (≤ `SCHEDULE_MAX_RANGE_DAYS`, archived masters excluded) is open to every role; `PATCH /api/schedule` `{ days: [{ masterId, date, working }] }` is admin-only, idempotent and all-or-nothing (one transaction; an archived or unknown master is a 404 and nothing is saved). The page keeps the admin's marks as a draft and sends them only on «Сохранить»; leaving the page with a draft asks for confirmation. The booking form and `BookingEditDialog` (future dates only — old bookings predate the schedule) warn (never block) when a chosen master is off on a booking day via `useDaysOffWarning` → shared `findDaysOff`. Any unmarked day is off, even in a month nobody has filled in yet, so the warning also nudges the admin to fill in the schedule. The warning loads whole months (`scheduleMonthsRange`) so it shares the cache with the schedule page. Like the masters dropdown, the warning is best-effort and never makes the form depend on Postgres.

### Studio hours

`studio_hours` holds the studio's weekly mode: one row per **open** weekday (`weekday` 0 = Monday … 6 = Sunday, as in the schedule grid) with `opensAt`/`closesAt` in minutes from midnight; a missing weekday is closed and an empty table means «not set», so `PUT /api/schedule/studio-hours` (admin-only via the `/api/schedule/*` guard) requires at least one day and replaces the whole week in one transaction. The wire format is `HH:MM` (`24:00` allowed for closing), closing strictly after opening, no overnight hours. `GET` is open to every role. On `/schedule` the header shows a one-line summary (`formatStudioHours` merges adjacent weekdays with equal hours, hidden while not set) and admins edit it in `StudioHoursDialog` via «Режим работы», shown only once the hours have loaded so an empty dialog can't overwrite them; the grid highlights the studio's closed weekdays, falling back to Sat/Sun while the mode is not set; off cells on closed days are also hatched (the `closed-hatch` utility in `globals.css`), labeled «…, студия закрыта» and listed in the legend, but only when the mode is set — on the page and in `ScheduleRequestPreviewDialog` alike, both through `useStudioWeekdays`. A working day can't be put on a closed day: `applyScheduleDays` (admin `PATCH /api/schedule` and request approval) and `createScheduleRequest` check `datesOnClosedDays` and answer 400 `{ error: 'validation', reason: 'studio_closed', dates }`; taking a day off is always allowed, so marks left over from an earlier mode can be removed (changing the mode never touches existing marks). On the page such cells are disabled unless already working, «Весь месяц» skips them, and the request preview blocks «Одобрить» with an alert when the request asks for one (the mode may have changed after submission). While the mode is not set nothing is restricted by weekday.

One-off closed days («Выходные»: holidays etc.) live in `studio_closed_days` (just a `date` PK, no name). `GET /api/schedule/closed-days?from&to` (≤ `CLOSED_DAYS_MAX_RANGE_DAYS`, any role) lists them; admins `POST` a range `{ from, to }` (inclusive, ≤ `CLOSED_DAYS_MAX_BATCH` days, days already closed are skipped) and `DELETE /closed-days/{date}` one day at a time through `ClosedDaysDialog` («Выходные» on `/schedule`: an inline month grid styled like the master's calendar on `/schedule` (closed days hatched, the picked range filled; first tap is the start, second the end, the same day twice is one day), opened on the month of the server's `today`, the next 365 days; consecutive dates are listed as one range whose delete removes each day). They act exactly like closed weekdays — hatched, locked, rejected as `studio_closed` by `applyScheduleDays` / `createScheduleRequest` (`datesOnClosedDays`'s third argument) — and apply even while the weekly mode is not set. `useStudioWeekdays(range)` loads them for the shown range. Nothing else uses it yet: bookings and the days-off warning ignore it.

### Schedule requests

A non-admin linked to a master (`masters.userId`) changes their own schedule only through a request: on `/schedule` they mark days of their own master (past days too — that is how a master fixes days worked off-schedule; only `SCHEDULE_REQUEST_HORIZON_DAYS` ahead is capped) and send them to `POST /api/me/schedule-requests`; the master comes from the session, never from the body. `schedule_requests` stores the days as a jsonb snapshot `[{ date, working }]` — only the changes, not the whole month — and a partial UNIQUE keeps at most one `pending` request per master (a second submit is a 409 `pending_exists`). The employee may withdraw a pending request, which deletes the row.
- Any admin decides the whole request: approve applies all its days to `master_schedule` (`applyScheduleDays`) and flips the status in **one transaction**, with the request locked `FOR UPDATE` so a second admin gets 409 `already_decided`; reject only stores an optional comment. `decidedByName` is a snapshot, like the audit log's actor.
- Notifications are in-app only: a pending counter on «График» in the sidebar for admins (polled every minute), a panel on `/schedule` for admins, and a card with the latest decision (shown for 7 days) for the employee. No Telegram.
- Requests of archived masters are hidden from the admin list, and approving one is a 404.
- The page learns the viewer's own master from `GET /api/me/schedule-requests` (`masterId`) for every role, admins included, and highlights that row (and marks it «(вы)» in the phone picker); `UserPublic` carries no id to match `masters.userId` client-side.

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

`src/lib/api-base.ts` returns `VITE_API_BASE_URL` if set, otherwise `''` — requests stay **relative** (`/api/...`) in both dev and prod so the auth cookie is first-party (`SameSite=Lax`). In dev, Vite's `server.proxy` forwards `/api` to `VITE_API_PROXY_TARGET` (default `localhost:3000`). In prod the web container is nginx (`apps/web/nginx/`), which serves the build and forwards `/api` to the API service; `VITE_API_PROXY_TARGET` (Railway internal URL, read at container start despite the prefix) is **required** there and the container exits at startup without it — a silent localhost fallback once caused every `/api` call to 502. `proxy_pass` goes through a variable so the host is re-resolved per request. Setting `VITE_API_BASE_URL` to another origin makes the cookie third-party, which browsers drop.

### UI primitives (shadcn-vue)

Base components live in `apps/web/src/components/ui/<name>/` — the full shadcn-vue registry is vendored in (accordion, alert, alert-dialog, button, calendar, card, command, dialog, drawer, dropdown-menu, form, input, popover, select, sheet, sidebar, table, tabs, toast/sonner, tooltip, … see the directory for the complete list). Each folder exports a barrel `index.ts`; import as `@/components/ui/<name>` (the `@` alias points at `apps/web/src/`). Config: `apps/web/components.json` — style `new-york`, base color `neutral`, CSS variables, icon library `lucide`, aliases `@/components`, `@/composables`, `@/lib/utils`, `@/components/ui`, `@/lib`.

## Conventions

- **TypeScript:** `tsconfig.base.json` sets `verbatimModuleSyntax: true` and `moduleResolution: Bundler`. Use `import type` for type-only imports. Cross-package imports use `.js` suffix (ESM resolution) — keep this for consistency.
- **Typecheck the web app via `pnpm typecheck`** (it runs `vue-tsc -b --noEmit`). A bare `vue-tsc --noEmit` in `apps/web` checks nothing, because the root tsconfig only holds project references, so it always passes.
- **Tailwind v4:** Avoid `[arbitrary]` brackets for sizing/spacing — use the dynamic spacing scale (e.g. `min-w-200` = 50rem). Brackets are OK for variant selectors and arbitrary CSS properties without a utility equivalent.
- **Filters live in the URL:** list pages keep their filters, sort and page in the query via `useQueryParam` (`src/composables/use-query-param.ts`), so a reload or a shared link reopens the same view; defaults are never written. Reset the page on filter change with `watchFilters` (a plain `watch` would also fire when the filters come from the URL and drop its `page`), and clamp the page with `keepWithin(total)`. `/clients` and `/clients/:id` share the params, so opening and closing the card carry `route.query` over. Pages mounted in tests need a router: `test/helpers/router.ts`.
- **Mobile-first layouts:** list pages render tables on wide screens and cards / collapsible sections on narrow ones. Keep both variants in sync when adding a column.
- **Russian-only:** UI strings, error messages, sheet headers, enum values are Russian. Phone numbers are `+7`-only by design.
- **Money is int:** amounts are whole rubles in `integer` columns; durations are integer minutes.
- **Commits:** Conventional Commits 1.0.0 (`feat`, `fix`, `chore`, `refactor`, etc., optional scope). Description only — no body. No `Co-Authored-By` trailer.
- **Tests:** Vitest unit tests under `<package>/test/`. The Sheets client is mocked via `_setClientForTest()` and boot state via `_resetForTest()` / `_setDbReadyForTest()` — never make real Sheets or DB calls in tests. reka-ui `Dialog` content is teleported, so in web component tests query it through `document`, not the mount wrapper.
- **Tests are linted and type-checked too** (`@vitest/eslint-plugin`; web tests via `apps/web/tsconfig.test.json`). Narrow a result with `assert(result.ok)` from vitest, not `if (result.ok) expect(…)`.
- **Web tests run in Vitest Browser Mode** (Chromium via `@vitest/browser-playwright`, config in `apps/web/vitest.config.ts`). A `vi.mock` factory can't add exports the real module lacks, since they arrive `undefined`: share state with `vi.hoisted`. Stubs use render functions, not a string `template`, because the browser build of Vue has no compiler. Component tests act like a user: `mount` with `attachTo: document.body`, then `page` locators, `.click()`/`.fill()` and `expect.element` (the IME and `pointerup` tests stay on synthetic events, which real input can't reproduce). Locators match the **whole string** by default (`browser.locators.exact`), so a partial string in `not.toBeInTheDocument()` always passes: use a RegExp there.
- **Drizzle:** `drizzle.config.ts` has `casing: 'snake_case'` — write columns in camelCase TS (`sectionId`) and they map to `section_id` in SQL. Migrations live in `apps/api/drizzle/`; never hand-edit the generated SQL — change `schema.ts` and re-run `db:generate`. Migration files and `drizzle/meta/*` must be committed together.
- **Seed data:** `apps/api/.seed/` is gitignored (contains PII: client phones from historical sheets). The pricelist JSON also lives there and is intentionally outside git — regenerate it manually if a fresh checkout needs it. `seed:dump` regenerates `clients.json` from Sheets; there is no dump script for the pricelist.
- **Backlog:** `TODO.md` lists feature candidates with value/complexity notes; mark items `✅ Выполнено` with a status line when they ship.

## Pitfalls

- **Don't write to row 1** — the sheet header lives there. `spreadsheets.values.append` with range `'Запись 2026'!A1` appends below the detected table; never use `values.update` on row 1.
- **Don't add per-request logging on boot-state short-circuit** — the startup line is the only signal by design.
- **Don't cache non-ok results in the idempotency map** — the route relies on `ok: true` being the only thing in the map and evicts anything else on hit.
- **Don't rename a header** (e.g. column K `Ответственный`) without updating both the sheet and `EXPECTED_HEADERS` in the same change.
- **Don't switch to `RAW`** for the Sheets append — `USER_ENTERED` is what makes column H a number, column A a date, and columns I/J/K satisfy data validation.
- **Don't make the booking `POST` depend on Postgres.** The client/car upsert, the `bookings` mirror insert and the notifications written with it are best-effort; if the DB is down, the booking still goes to Sheets and returns 201. Only the Postgres-backed routes should consult `isDbReady()`.
- **Don't forget to regenerate the client.** A route or schema change without `gen:openapi` + `gen:client` still type-checks (the generated `unwrap()` casts), so only `openapi-drift.test.ts` catches it.
- **Don't add a `fetch` handler or precache to `sw.js`.** It exists only for push; caching there would pin users to an old deploy, which nginx's `no-cache` on `/` deliberately prevents.
- **Don't turn on `TELEGRAM_POLLING` locally with the prod bot token.** `getUpdates` hands each update to one poller, so a local process would steal `/start` messages from prod.
- **Don't put salary-sensitive columns on `masters`.** `GET /api/masters` is open to employees; rates live in `master_rates` for that reason.
- **Don't rewrite `input.value` while an IME composition is active.** Gboard on Android keeps a word in composition until a space/commit, and Vue's `v-model` refuses to touch the DOM while `el.composing` is set — so anything written programmatically lands in state only and the field keeps showing the typed prefix. Input masks (`onCarInput`, `onNameInput`, `onLicensePlateInput`, `ClientFormDialog.onPlateInput`) skip their turn on `InputEvent.isComposing` and re-mask on the closing `input`. Numeric fields are safe only because `inputmode="numeric"/"tel"/"decimal"` keeps the IME out. Prior art: `ui/command/CommandInput.vue`.
- **Select suggestions on `pointerup`, never on mouse events.** An event log from an emulated Pixel settles what the «Марка и модель» autocomplete has to do: a tap on a list item fires `pointerdown → mousedown → focusout → pointerup`, and `mouseup`/`click` never arrive at all, because the item is gone by the time they would. So the pick rides on `pointerup`; `pointerdown.prevent` keeps focus (and the mobile keyboard) in the field without blocking scroll, which `touch-action` governs; a drag beyond `CAR_TAP_SLOP_PX` scrolls instead of selecting; items are `<li>` rather than `<button>`; the list is a plain `absolute` element, not a `Popover` (`PopoverContent` has `tabindex="-1"` and steals focus); and it never closes on `blur` — that fired mid-tap. Closing is on pick, Escape, or a document `pointerdown` outside `[data-car-input]`/`[data-car-suggestions]`. Popovers with a real trigger button (`ServicePicker`, `MasterMultiSelect`, date pickers) need none of this — reka-ui handles it.
- **Don't commit anything from `apps/api/.seed/`.** The directory is gitignored on purpose (PII in `clients.json`; pricelist intentionally regenerated locally). If a fresh checkout needs the pricelist, regenerate `pricelist.json` from the source Sheets — there is no dump script for it.
