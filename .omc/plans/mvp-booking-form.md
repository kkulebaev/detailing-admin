# MVP — Mobile Booking Form → Google Sheets

Single-feature first iteration of the detailing-shop admin app. Mobile-first web form that appends one row to the owner's existing Google Sheet (`1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw`, tab `Запись 2026`).

Mode: **ralplan / SHORT** (consensus planning, single-day-effort feature, low blast radius). Not `--deliberate` — no pre-mortem expansion. The architecture is conventional and reversible; the only non-reversible decision (column-mapping contract) is captured under the data contract and ADR.

---

## 1. RALPLAN-DR summary

### Principles
- **Mirror the sheet, do not reinvent it.** The Google Sheet is the source of truth for shape and headers — including the misspelled `Ответсвенный`. The app writes the existing schema verbatim.
- **Minimum viable surface area.** One route, one form, one API endpoint, one external dependency (Sheets). No DB, no auth, no caching layer.
- **Type the wire once.** A single zod schema in `packages/shared` is the contract between Vue and Hono — no duplicated DTOs.
- **Prefer Google's interpretation of values to ours.** `valueInputOption=USER_ENTERED` lets Sheets parse dates, numbers, and validation hits the same way a human would entering the row.
- **No-auth is a known, time-boxed risk, not a forgotten one.** Document it loudly, add `noindex`, queue follow-up.

Note: "Minimum viable surface area" is overridden by Driver 3 (cheap evolution) in Option A; the chosen split accepts CORS + two cold starts to preserve the week-2 evolution path.

### Decision Drivers (top 3)
1. **Owner ships and uses it today.** Zero-friction UX on a phone, no login wall, no learning curve.
2. **Schema fidelity with the live sheet.** A wrong column, header typo, or value format silently corrupts an active business workflow.
3. **Reversibility / cheap evolution.** Anything we ship must be replaceable in week 2 (auth, list view, edit view) without rewrites.

### Viable Options

#### Option A — Two Railway services (chosen)
`apps/web` (Vue + Vite static build, served by Railway's static/nginx) and `apps/api` (Hono on `@hono/node-server`). Web calls API via `VITE_API_BASE_URL`.

- Pros: Clear separation; each service scales / redeploys independently; CORS contract forces clean boundary; mirrors team's future split (worker dashboard vs customer-facing surfaces).
- Cons: Two URLs to manage; CORS config required; two Railway services to provision.

#### Option B — Single Hono service serving the built Vue assets
Vite builds to `apps/web/dist`, Hono mounts `serveStatic({ root: '../web/dist' })` and exposes `/api/*` alongside.

- Pros: One URL, no CORS, one Railway service, smaller surface to misconfigure.
- Cons: Couples web and api deploy lifecycles — that is the only real cost. The "harder SSR" and "static-hosting-not-Hono's-strength" arguments are weak; auth would still be one middleware line either way. Option A is chosen on Driver 3 (cheap evolution), not because Option B is bad.

#### Option C — Frontend-only with a serverless function for the Sheets write
Vue app + a single Railway function or Vercel edge function.

- Pros: Even less infra.
- Cons: User said "Hono on Node" and "Railway both apps" — out of scope. **Invalidated by hard constraint.**

**Pick: Option A.** Driver 3 (cheap evolution) wins — once we add auth and a "Today's bookings" view, the two-service split is what we want anyway. The CORS overhead is one `app.use('*', cors({ origin: WEB_ORIGIN }))` line.

---

## 2. Chosen approach (per open question)

| # | Question | Decision |
|---|----------|----------|
| 1 | Monorepo layout | `apps/web` + `apps/api` + `packages/shared` (zod schemas + types). pnpm workspaces, no Turbo/Nx — `pnpm -r --parallel run dev` is enough for 3 packages. |
| 2 | Date-range UX | One date picker by default + a "Несколько дней" (multi-day) toggle that reveals a second date input ("по"). Two discrete pickers beat one range picker on phones — taps are cheaper than drags, and the result serializes deterministically into the cell. |
| 3 | Phone normalization | Store as **E.164** `+7XXXXXXXXXX`. Input mask `+7 (___) ___-__-__` via `maska`/custom directive. Empty is allowed and stored as empty string. Old mixed-format rows are not touched. |
| 4 | Dropdown source (Мастер / Ответственный / Готовность) | **Hardcoded** in `packages/shared/src/enums.ts` for MVP. Evolution path: read `dataValidation` from the sheet via `spreadsheets.get?ranges=Запись 2026!I:K&fields=sheets.data.rowData.values.dataValidation` and cache in Hono memory. Tracked as follow-up. |
| 5 | PWA | Defer. Ship a plain responsive page with a good `<meta viewport>` and a 512px maskable icon for future PWA upgrade, but no manifest/service worker now. |
| 6 | Validation | zod in `packages/shared`, consumed by `vee-validate + @vee-validate/zod` on the client and `@hono/zod-validator` on the server. Same schema, two adapters. |
| 7 | Sheets write strategy | `spreadsheets.values.append` with `valueInputOption=USER_ENTERED`, `insertDataOption=INSERT_ROWS`, `range='Запись 2026'!A1`. USER_ENTERED preserves data-validation dropdown matching and number formatting. Edge cases handled in §7. |
| 8 | Form feedback | Pessimistic UI. Submit button shows spinner + disables; on 2xx → `sonner` success toast + reset form; on 4xx → inline field errors from server zod issues; on 5xx / network → toast with **Повторить** action that re-submits the same payload. **Special case:** when the body discriminates `error === 'unavailable'` (HTTP 503 + `reason: 'headers_mismatch'`), render a distinct, non-dismissable error banner exposing `column_index`, `expected`, and `observed` so the owner can correct the sheet immediately — falling back to the generic 5xx retry toast would discard the diagnostic fields that the discriminated union exists to carry. |
| 9 | Railway shape | Two services (Option A). `web` is a static-served Vite build; `api` is Node. |
| 10 | Local dev | pnpm only: `pnpm -r --parallel run dev`. Concurrency comes from pnpm; no Turbo/Nx. |
| 11 | Secrets | Dev: `apps/api/.env` (gitignored), service-account JSON base64 in `GOOGLE_SERVICE_ACCOUNT_JSON_B64`. Prod: Railway variables, same name. Decoded once at boot. `.env.example` checked in with empty values + comments. |
| 12 | "MVP done" | See §9 Acceptance criteria. |

---

## 3. Repository / package layout

```
detailing-admin/
├── package.json                 # pnpm workspace root, name "detailing-admin", private, packageManager: pnpm@…
├── pnpm-workspace.yaml          # packages: apps/*, packages/*
├── .gitignore                   # node_modules, .env, dist, .turbo (future)
├── .nvmrc                       # node 22 LTS
├── README.md                    # 1-page: setup, env vars, deploy
├── apps/
│   ├── web/                     # Vue 3 + Vite + shadcn-vue
│   │   ├── package.json         # name "@detailing/web"
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts   # Tailwind v4 — uses CSS-first config
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   ├── router.ts        # 2 routes: '/' (form), '/ok' (success placeholder, optional)
│   │   │   ├── pages/
│   │   │   │   └── NewBooking.vue
│   │   │   ├── components/
│   │   │   │   ├── BookingForm.vue
│   │   │   │   ├── DateOrRangeField.vue
│   │   │   │   ├── PhoneField.vue
│   │   │   │   └── ui/          # generated by shadcn-vue CLI
│   │   │   ├── lib/
│   │   │   │   ├── api.ts       # fetch wrapper
│   │   │   │   └── utils.ts
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   └── public/
│   │       └── robots.txt       # User-agent: *  Disallow: /
│   └── api/                     # Hono on Node
│       ├── package.json         # name "@detailing/api"
│       ├── tsconfig.json
│       ├── .env.example
│       └── src/
│           ├── index.ts         # @hono/node-server bootstrap
│           ├── app.ts           # Hono instance, CORS, routes
│           ├── routes/
│           │   └── bookings.ts  # POST /api/bookings
│           ├── sheets/
│           │   ├── client.ts    # googleapis Sheets client, service-account auth
│           │   └── append.ts    # rowFromBooking() + append()
│           └── env.ts           # zod-validated process.env
└── packages/
    └── shared/
        ├── package.json         # name "@detailing/shared", exports { ".": "./src/index.ts" }
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts
        │   ├── enums.ts         # MASTERS, RESPONSIBLES, READINESS
        │   ├── booking.ts       # zod schema + inferred type
        │   ├── date.ts          # parseDdmmyyyy()
        │   ├── phone.ts         # normalizePhone()
        │   └── sheet-row.ts     # mapping helpers + EXPECTED_HEADERS
        └── test/
            ├── booking.test.ts
            ├── phone.test.ts
            ├── date.test.ts
            └── sheet-row.test.ts
```

Notes:
- `@detailing/shared` is consumed via workspace protocol (`"@detailing/shared": "workspace:*"`); no build step — both apps import `.ts` directly through their tsconfig path mapping. Avoids a fourth tool.
- Tailwind v4 in `apps/web`: per the user's rule, avoid `[arbitrary]` brackets for sizing/spacing; use the dynamic spacing scale (e.g. `min-w-200` for 50rem).
- shadcn-vue CLI writes into `apps/web/src/components/ui` (per https://www.shadcn-vue.com).

---

## 4. Data contract

### zod schema (sketch — lives in `packages/shared/src/booking.ts`)

```ts
import { z } from 'zod'
import { RESPONSIBLES, READINESS } from './enums'
import { parseDdmmyyyy } from './date'
import { normalizePhone } from './phone'

const ddmmyyyy = z
  .string()
  .regex(/^\d{2}\.\d{2}\.\d{4}$/, 'DD.MM.YYYY')

export const bookingSchema = z
  .object({
    // A — Дата
    dateFrom: ddmmyyyy,
    dateTo: ddmmyyyy.optional(), // present only when multi-day
    // B — Время
    time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
    // C — Имя
    name: z.string().max(120).default(''),
    // D — Номер (E.164 +7XXXXXXXXXX, or empty) — normalized in .transform() below.
    // The regex here is only a permissive accept-mask; normalization happens via normalizePhone().
    phone: z.string().max(40).default(''),
    // E — Машина
    car: z.string().max(200).default(''),
    // F — Услуга
    service: z.string().max(2000).default(''),
    // G — Примечание
    note: z.string().max(2000).default(''),
    // H — Сумма, ₽ (integer or empty)
    amount: z.union([z.number().int().nonnegative(), z.literal('')]).default(''),
    // I — Готовность
    readiness: z.enum(READINESS).or(z.literal('')).default(''),
    // J — Мастер
    // MVP: free-text. When MASTERS is non-empty, swap back to z.enum(MASTERS).or(z.literal('')).default('').
    master: z.string().max(120).default(''),
    // K — Ответсвенный (NOTE: typo preserved on purpose)
    responsible: z.enum(RESPONSIBLES).or(z.literal('')).default(''),
  })
  .superRefine((v, ctx) => {
    // Date-order check uses parsed Date objects, not lex compare.
    if (v.dateTo) {
      const from = parseDdmmyyyy(v.dateFrom)
      const to = parseDdmmyyyy(v.dateTo)
      if (to.getTime() < from.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateTo'],
          message: 'Конец диапазона раньше начала',
        })
      }
    }
  })
  .transform((b, ctx) => {
    // Normalize phone; normalizePhone() may push a ZodIssue on malformed input.
    try {
      const phone = normalizePhone(b.phone)
      // Collapse `dateFrom === dateTo` to single-day. Without this, a user who toggled
      // "Несколько дней" but kept both pickers on the same calendar day would produce a
      // TEXT cell of the form `'04.06.2026-04.06.2026`, while a user who never toggled
      // produces a DATE cell with `04.06.2026`. Same logical date, two different cell
      // types — confusing for the owner and for any future read path. Byte-equality on
      // the regex-validated DD.MM.YYYY string is safe here.
      const dateTo = b.dateTo && b.dateTo !== b.dateFrom ? b.dateTo : undefined
      return { ...b, phone, dateTo }
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: e instanceof Error ? e.message : 'Неверный номер',
      })
      return z.NEVER
    }
  })

export type Booking = z.infer<typeof bookingSchema>
```

`packages/shared/src/enums.ts`:

```ts
export const READINESS = ['Выдана', 'Отмена'] as const
export const MASTERS = [] as const // empty for MVP — column J usually empty in source data
export const RESPONSIBLES = [
  'Вячеслав Толстов',
  'Сергей Теплов',
  'Дмитрий Глотов',
  'Иван Содель',
  'Андрей и ко.',
  'Отмена',
] as const
```

(MVP renders Мастер as a free-text input bound to a plain `z.string()`. The `MASTERS` constant stays in `enums.ts` as an empty `as const` array; the moment the owner names the masters we (a) populate it and (b) swap the `master` field back to `z.enum(MASTERS).or(z.literal('')).default('')`. We do **not** apply `z.enum()` to an empty array — zod throws at module load.)

### Phone normalization

A pure helper `normalizePhone(raw: string): string` lives in `packages/shared/src/phone.ts`. Behavior:

1. Strip all characters except digits and `+`.
2. If empty after strip → return `''`.
3. If starts with `8` and total digits = 11 → replace leading `8` with `+7`.
4. If starts with `7` and total digits = 11 → prefix `+`.
5. If already matches `^\+7\d{10}$` → return as-is.
6. Otherwise → `throw new Error('Неверный номер')` (caught by the schema's `.transform()` which converts it into a path-targeted ZodIssue on `phone`).

The schema (above) wires this via `.transform()` at the object level so the issue path is `['phone']`. The field-level zod accepts a permissive raw string; normalization + final shape enforcement happen in one place. Unit tests for the helper live at `packages/shared/test/phone.test.ts` (see §10).

### Date helper

`parseDdmmyyyy(s: string): Date` in `packages/shared/src/date.ts` splits on `.`, builds `new Date(Date.UTC(yyyy, mm-1, dd))`, and is used by the schema's `superRefine` to compare `dateTo` against `dateFrom` correctly across month/year boundaries (lexicographic compare on `DD.MM.YYYY` is wrong: `02.01.2026` is lex < `30.12.2025`).

### Column mapping (A..K)

| Col | Header (verbatim) | From `Booking` field | Serialization rule |
|-----|-------------------|----------------------|--------------------|
| A | `Дата` | `dateFrom` (+ optional `dateTo`) | If `dateTo` absent → raw `dateFrom` string (Sheets parses it as DATE under `USER_ENTERED` + ru locale). If present → `'${dateFrom}-${dateTo}'` with a **leading single apostrophe** to force TEXT under `valueInputOption=USER_ENTERED`; otherwise Sheets attempts numeric/date parsing on the hyphen and corrupts the value. No spaces around the hyphen (mirrors current sheet style). |
| B | `Время` | `time` | `HH:MM`, zero-padded |
| C | `Имя` | `name` | string |
| D | `Номер` | `phone` | empty string OR `+7XXXXXXXXXX` |
| E | `Машина` | `car` | string |
| F | `Услуга` | `service` | string; newlines preserved (passed through `USER_ENTERED`) |
| G | `Примечание` | `note` | string; newlines preserved |
| H | `Сумма, ₽` | `amount` | integer literal (so Sheets parses as number) or empty |
| I | `Готовность` | `readiness` | one of `READINESS` or empty |
| J | `Мастер` | `master` | string |
| K | `Ответсвенный` | `responsible` | one of `RESPONSIBLES` or empty |

The mapping is a pure function `bookingToRow(b: Booking): (string | number)[]` in `packages/shared/src/sheet-row.ts`. **Header row in the sheet is row 1; we never write to row 1**. `values.append` with range `'Запись 2026'!A1` lets Google find the table and append after the last filled row (see §7 edge cases).

`packages/shared/src/sheet-row.ts` also exports a frozen constant used by the API's boot-time header verification (§7):

```ts
export const EXPECTED_HEADERS = Object.freeze([
  'Дата',        // A
  'Время',       // B
  'Имя',         // C
  'Номер',       // D
  'Машина',      // E
  'Услуга',      // F
  'Примечание',  // G
  'Сумма, ₽',    // H
  'Готовность',  // I
  'Мастер',      // J
  'Ответсвенный',// K — typo preserved verbatim, do not "fix"
] as const)
```

---

## 5. API contract

### Endpoints

- `GET  /healthz` → `{ ok: true, time: ISO8601 }`. No auth, no Sheets call. For Railway healthcheck.
- `POST /api/bookings` → create one row.
  - Request: `application/json`, body = `Booking` (per §4 schema).
  - Required header: `Idempotency-Key: <uuid-v4>` (client-generated at form-mount, reused on every retry of the same payload until first success).
  - Response header (always): `X-Request-Id: <uuid>` (mirrors the structured log line — see Observability).
  - Validated by `@hono/zod-validator` (`zValidator('json', bookingSchema)`).
  - Success `201`: `{ ok: true, idempotent: boolean, updatedRange: string, updatedRow: number }`. `idempotent: false` for the first write; `idempotent: true` when the in-memory key cache returns a previously computed result.
  - Validation error `400`: `{ ok: false, error: 'validation', issues: ZodIssue[] }`.
  - Upstream/sheet error `502`: `{ ok: false, error: 'sheets', message: string, code?: string }`.
  - Generic error `500`: `{ ok: false, error: 'internal' }`.

### Idempotency

- Client generates a UUID v4 on form mount and passes it in the `Idempotency-Key` header. The same key is reused for every retry of the same payload (`Повторить` button); a successful submit + form reset rolls a fresh key.
- API holds an in-memory `Map<string, { at: number; result: ApiResult<…> }>` with a **5-minute TTL**. A repeated key inside the window returns the cached response **without** re-writing to Sheets, and sets `idempotent: true`.
- A simple TTL sweep on each insert (cheap; map is small) evicts expired entries. After TTL or across a process restart, a re-submit accepts a second write — explicitly acceptable on a single Railway instance (see §11).
- The key is **not** part of the zod body schema; it's read from headers in the route handler before the validator runs.

### Observability

- One structured JSON log line is emitted to stdout per `POST /api/bookings` via `pino` (or `@hono/logger` with a pino transport). Required fields:
  - `request_id` (uuid; also returned as `X-Request-Id` response header)
  - `idempotency_key` (string, the inbound header value or `null`)
  - `idempotent` (boolean, true if served from the dedupe cache)
  - `validation_failed` (boolean)
  - `sheets_latency_ms` (number; `null` if the Sheets call was not attempted)
  - `sheets_status_code` (number; `null` if not attempted)
  - `sheets_error_code` (string; present only when the Sheets call failed)
  - `status` (HTTP response status)
- Boot-time emits one `boot.headers.ok` or `boot.headers.mismatch` line (see §7).
- No payload bodies are logged — only metadata. `phone`, `name`, and `note` never enter logs.

### Error model

A single discriminated-union response shape lives in `packages/shared`:

```ts
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; error: 'sheets'; message: string; code?: string }
  | { ok: false; error: 'internal' }
  | {
      ok: false
      error: 'unavailable'
      reason: 'headers_mismatch'
      column_index: number
      expected: string
      observed: string
    }
```

### Env vars (`apps/api/.env.example`)

```
SPREADSHEET_ID=1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw
SHEET_NAME=Запись 2026
GOOGLE_SERVICE_ACCOUNT_JSON_B64=     # base64(service-account JSON key)
WEB_ORIGIN=http://localhost:5173     # CSV allowed; in prod: https://<web>.up.railway.app
PORT=3000
LOG_LEVEL=info
```

`apps/api/src/env.ts` parses `process.env` with a zod schema at boot; the process exits if validation fails. Base64 is used so Railway's UI can paste a single line without JSON-escape pain.

**Service-account key handling (security-critical):**

- README's setup section states verbatim: **"Paste the base64 value with NO surrounding quotes — Railway's env UI does not strip them, and a quoted value will fail base64 decoding."**
- `apps/api/src/env.ts` declares `GOOGLE_SERVICE_ACCOUNT_JSON_B64` as a redacted / non-enumerable property on the exported env object. Any thrown env-parse error replaces the value with `'[REDACTED]'` before it can reach a stack trace or log line.
- The decoded JSON is **never logged**: not on boot, not on auth failure, not on Sheets error. The Sheets client constructor receives the parsed credentials object once and the raw decoded string is dropped from scope immediately.
- Pino's `redact` config also lists `GOOGLE_SERVICE_ACCOUNT_JSON_B64` and `credentials` as redacted paths as a defence-in-depth measure against accidental `logger.info({ env })` calls during future refactors.

### CORS

`app.use('/api/*', cors({ origin: WEB_ORIGIN.split(','), allowMethods: ['POST','GET','OPTIONS'], allowHeaders: ['Content-Type', 'Idempotency-Key'] }))` — per Hono docs.

**CORS here is a UX/origin-restriction control, not access control.** Anyone who knows the API URL can `curl` it directly and bypass CORS entirely — browsers enforce CORS, attackers don't. Real access control is the auth follow-up (§11, §12 follow-ups).

---

## 6. Frontend plan

### Routes

- `/` → `pages/NewBooking.vue` (the only meaningful page).
- The router exists but has one route; we keep `vue-router` in for the imminent follow-up (list/edit views).

### shadcn-vue components used

(All installed via `npx shadcn-vue@latest add <name>` per the official site; written to `apps/web/src/components/ui`.)

- `Button`, `Input`, `Textarea`, `Label`, `Select`, `Switch`, `Popover`, `Calendar`, `Sonner` (toast), and the `Form` family: `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`.

### Form state

`vee-validate@^4` + `@vee-validate/zod` (`toTypedSchema(bookingSchema)`). This is the pattern shadcn-vue's own Form docs use, so we stay on the well-trodden path. `@tanstack/vue-form` is considered and rejected for MVP — fewer examples in shadcn-vue's docs, no upside here.

**Phone field binding (critical).** The phone input is bound to the **raw masked string** the user sees in the field (via `useField('phone')` keyed to a local `ref<string>`), **not** to the zod-transformed output. If we bound it to the schema's parsed value, every successful parse mid-typing would rewrite the visible input from `8 999 12...` to `+79991234567`, destroying the cursor position and confusing the user. Normalization runs only at submit time: either the client calls `normalizePhone()` once just before `fetch()` (preferred — gives the user a chance to see the canonical form in any "review" step) or relies on the server's `.transform()` to canonicalise — both are correct because the schema is the same on both ends. Field-level zod validation on `phone` is intentionally permissive (`z.string().max(40)`) so partially-typed values never trip a ZodIssue mid-keystroke; the strict shape check fires only on submit.

### Mobile-UX notes

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Touch targets ≥ 44px tall (Tailwind `h-11` / `h-12`).
- Numeric phone field uses `inputmode="tel"`, masked.
- Amount field uses `inputmode="numeric"`.
- Time picker: native `<input type="time">` wrapped by shadcn `Input` styling — better than a custom popover on phones.
- Date picker: shadcn `Calendar` inside `Popover`, default selection = today. The "Несколько дней" `Switch` reveals a second `Calendar`-in-`Popover`.
- Submit button is sticky to the bottom of the viewport on small screens (`sm:static` upstream) so the user does not scroll to confirm.
- All multiline fields (`Услуга`, `Примечание`) use `Textarea` with `rows="3"` and `autosize` via CSS `field-sizing: content` (modern, falls back gracefully).
- The page sets `<meta name="robots" content="noindex,nofollow">` plus `public/robots.txt` disallowing all — defense in depth for the no-auth window.

---

## 7. Sheets integration plan

### Auth setup (one-time, documented in README)

1. Create a GCP project.
2. Enable Google Sheets API.
3. Create a Service Account; create a JSON key; download.
4. Share the target spreadsheet (`1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw`) with the service account's email as **Editor**.
5. `base64 -w0 key.json` → paste into `GOOGLE_SERVICE_ACCOUNT_JSON_B64`.

### Client (`apps/api/src/sheets/client.ts`)

- Use the official `googleapis` npm package.
- `new google.auth.GoogleAuth({ credentials: JSON.parse(atob(b64)), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })`.
- Cache the `sheets_v4.Sheets` client at module scope; the auth client refreshes tokens internally.

### Write call (`apps/api/src/sheets/append.ts`)

```
POST https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{encodeURIComponent(SHEET_NAME)}!A1:append
  ?valueInputOption=USER_ENTERED
  &insertDataOption=INSERT_ROWS
  &includeValuesInResponse=false
body: { values: [ bookingToRow(booking) ] }   // single row, 11 cells A..K
```

Per the Google Sheets REST v4 reference for `spreadsheets.values.append`, this:
- finds the table starting at `A1`,
- appends after the last row of that table (so header in row 1 is left alone),
- with `USER_ENTERED`, Sheets parses values exactly as if a user typed them — meaning column H's `200000` becomes a number, column A's `04.06.2026` is parsed as a date in the sheet's locale, and column I/K dropdown validation accepts the value as a list match.

**Column A serialization under `USER_ENTERED`:**

- Single-day booking (no `dateTo`) → cell value is the raw `dateFrom` string `DD.MM.YYYY`. Sheets parses it as a DATE under the ru-RU locale.
- Multi-day booking (`dateTo` present) → cell value is `'${dateFrom}-${dateTo}'` with a **leading single apostrophe**. Under `valueInputOption=USER_ENTERED`, an apostrophe-prefixed value is stored as TEXT verbatim (the apostrophe itself is consumed and does not appear in the cell content). Without the prefix, Sheets attempts to parse the hyphen as a numeric expression and corrupts the value.
- `bookingToRow()` in `packages/shared/src/sheet-row.ts` owns this branch — the prefix is added there, not in the API route, so unit tests cover it.

### Boot-time header verification

- On API process start, after env parse and Sheets client init, the API performs one `spreadsheets.values.get` against range `'{SHEET_NAME}'!A1:K1` with `valueRenderOption=UNFORMATTED_VALUE`.
- The returned 11-cell row is compared element-by-element (byte-equality) to `EXPECTED_HEADERS` (defined in `packages/shared/src/sheet-row.ts`, see §4). The typo `Ответсвенный` is preserved verbatim in the constant — fixing it would deliberately trip this check (see §11 row 3 / Strict header-text policy below).
- Module-level state `bootState: 'ok' | 'headers_mismatch'` is set from the comparison result. The result of the first mismatched column (0-based index, expected value, observed value) is captured into `bootHeadersMismatch: { column_index, expected, observed } | null` for downstream use by the response builders.
- **On match:** `bootState = 'ok'`, emit one structured log line `{ event: 'boot.headers.ok', spreadsheet_id, sheet_name }`, and bind the HTTP listener.
- **On mismatch:** `bootState = 'headers_mismatch'`, emit one structured log line `{ event: 'boot.headers.mismatch', column_index, expected, observed }` exactly once on startup, **and still bind the HTTP listener.** The process does **not** call `process.exit(1)`. Rationale: on Railway a hard exit triggers crash-loop with exponential backoff, leaving zero healthy revisions and surfacing the issue only in the dashboard — a 503 from a live listener is observable by anyone curling `/healthz` and by Railway's healthcheck itself.
- While `bootState === 'headers_mismatch'`:
  - `GET /healthz` returns **HTTP 503** with body `{ ok: false, error: 'unavailable', reason: 'headers_mismatch', column_index, expected, observed }` (matches the `ApiResult` `unavailable` variant in §5).
  - `POST /api/bookings` **short-circuits before zod validation** and before any Sheets call — same 503 body, no idempotency cache lookup, no log line per request (the startup `boot.headers.mismatch` line is the single signal; per-request logging would flood stdout under any retry storm).
- State is **never** re-verified at runtime. The only way to clear `bootState` is a fresh process — operator restarts the service after correcting the sheet headers (or after merging an `EXPECTED_HEADERS` update PR).
- This is the primary mitigation against column reorder / column insertion / header rename done by the owner editing the sheet directly (§11). Follow-up: daily CI smoke check pinging the live header range so drift is caught even while the API is not being redeployed.

### Header-row handling

We **do not write the header**. The header in row 1 is already in place. `values.append` with the range starting at `A1` treats row 1 as the table header and appends below — verified by the Sheets docs ("table detected within the range"). We never call `values.update` on row 1.

### Dropdown-source decision

Hardcoded list of `RESPONSIBLES` + `READINESS` in `packages/shared/enums.ts` (see §4). Rationale: avoids a synchronous `spreadsheets.get` on every page-load, eliminates a failure mode on cold start, and the list churns rarely. Follow-up note (§13): if the owner adds a new responsible, they update the enum and redeploy — a 30-second turnaround. If that becomes painful, switch to runtime fetch with a 10-minute in-memory cache.

### Edge cases called out

- **Date locale parsing in Sheets.** The spreadsheet's locale must be Russian / `ru-RU` for `04.06.2026` to be parsed as a date. If the locale is set to US English, Sheets will store it as a string. Mitigation: the README's setup section explicitly tells the owner to verify Файл → Настройки → Локаль = Россия. We do not switch to `RAW`, because we want the dropdown columns I/K to be validated.
- **Empty trailing rows below the table.** `values.append` finds the *first* contiguous table from `A1`. If the owner has trailing empty rows between rows then a stray cell far below, Sheets may extend the table further than expected. Mitigation: documented as a known constraint; the form's success response includes `updatedRange`, which surfaces this in the toast for diagnostic value.
- **Range mis-spelling.** `SHEET_NAME` is read from env exactly as `Запись 2026` (with the space), URI-encoded once in the URL builder. Unit test for the URL builder asserts encoding.
- **Header drift / strict header-text policy.** `EXPECTED_HEADERS` is compared **byte-for-byte** against `A1:K1`. Renaming any header — including fixing the typo `Ответсвенный → Ответственный` — trips the boot-time check and puts the API into the 503 `headers_mismatch` state until a PR updates the constant. This is a deliberate trade-off: header renames are rare and intentional, so the cost of "one small PR to update `EXPECTED_HEADERS`" buys a hard guarantee that the storage layout matches the contract. Column letters alone are **not** enough — a row reorder that preserves K's position but swaps `Готовность` and `Мастер` text would silently corrupt every subsequent write under a positions-only check. (Note: this strictness combined with CA-1 means a typo fix breaks the form until the API redeploys, not the whole service — `bootState === 'headers_mismatch'` yields a clean 503 with a structured body, not a crash.)
- **Quota.** Sheets API v4 default: **60 read requests + 60 write requests per minute per user (a service account counts as one user).** Per-project limits are higher but irrelevant under a single service account. One booking ≈ one write. We will not approach quota. (Number reconciled with §11 row 4.)
- **Retry.** On 5xx / `ECONNRESET` we do **not** retry server-side — the client surfaces "Повторить" so the human owns the duplicate-row risk.
- **Round-trip read cost for multi-day TEXT cells.** When the future list view starts reading column A back, both `valueRenderOption=FORMATTED_VALUE` and `UNFORMATTED_VALUE` strip the leading apostrophe — so a stored TEXT range is indistinguishable from a DATE cell at the values endpoint. The only reliable disambiguator is `spreadsheets.get` with `fields=sheets.data.rowData.values.effectiveFormat.numberFormat.type`, which is a heavier call. Recorded as a known follow-up cost of any list/read feature; not relevant for the write-only MVP.

---

## 8. Deployment plan

### Services on Railway

1. **`detailing-web`** (Static)
   - Source: `apps/web`.
   - Build: `pnpm -w install --frozen-lockfile && pnpm --filter @detailing/web build`.
   - Output: `apps/web/dist`.
   - Served by Railway's static / nginx (or `serve -s dist -l $PORT` if Railway prefers a process).
   - Env vars: `VITE_API_BASE_URL=https://detailing-api.up.railway.app`.

2. **`detailing-api`** (Node)
   - Source: `apps/api`.
   - Build: `pnpm -w install --frozen-lockfile && pnpm --filter @detailing/api build`.
   - Start: `node dist/index.js` (compiled via `tsup` or `tsc`).
   - Healthcheck path: `/healthz`.
   - Env vars: `SPREADSHEET_ID`, `SHEET_NAME`, `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `WEB_ORIGIN` (the deployed `detailing-web` URL), `PORT` (Railway-injected), `LOG_LEVEL=info`.

### CORS

`apps/api` sets `WEB_ORIGIN=https://detailing-web.up.railway.app` (CSV-tolerant for local dev). The CORS middleware allows only those origins.

### Build orchestration

Root `package.json` scripts:
- `dev`: `pnpm -r --parallel run dev`
- `build`: `pnpm -r --filter ./apps/* run build`
- `lint`, `typecheck`: `pnpm -r run …`

No Turbo/Nx in MVP.

---

## 9. Acceptance criteria

A verifier — human or `verifier` agent — must be able to confirm **all** of the following:

1. `pnpm install` at the repo root completes cleanly on a clean clone with Node 22.
2. `pnpm -r --parallel run dev` starts the web on `http://localhost:5173` and the API on `http://localhost:3000`.
3. `curl http://localhost:3000/healthz` returns `{"ok":true,...}`.
4. Loading `http://localhost:5173/` on a mobile-width viewport (≤ 414px) shows the form with no horizontal scroll and a tap target of ≥ 44px on every interactive element.
5. Submitting a valid form **appends a new last row** to the live sheet, with each column populated per the §4 mapping. Verified by re-opening the sheet.
6. Submitting with a date range where `dateTo !== dateFrom` produces a single cell A with format `DD.MM.YYYY-DD.MM.YYYY` (see AC-16 for cell-type guarantees; the `dateFrom === dateTo` case collapses to the single-day path per §4 `.transform()`).
7. Submitting with phone `8 999 123 45 67` (any of the legacy variants typed by the user) writes `+79991234567` to column D.
8. Submitting with `Сумма, ₽ = 200000` results in a numeric cell (cell type `NUMBER` in Sheets, not text). Verifiable by clicking the cell and seeing right-alignment plus formula bar showing `200000`.
9. Picking `Готовность = Выдана` writes a value that satisfies the sheet's existing data validation on column I (no red triangle / "Invalid" warning).
10. Submitting a clearly invalid form (e.g. `time = "25:99"`) is rejected client-side by vee-validate and never hits the API.
11. Submitting a payload that bypasses the client (`curl` with bad JSON) returns `400` with a `validation` error body — server-side schema is enforced.
12. With the API stopped, submitting the form shows the `sonner` failure toast with a working "Повторить" action.
13. `<meta name="robots" content="noindex,nofollow">` is present on the live web URL and `/robots.txt` disallows all.
14. The committed repo follows Conventional Commits (verifiable via `git log`) and contains **no `Co-Authored-By`** trailer.
15. No Tailwind class in the codebase uses `[arbitrary]` brackets for sizing/spacing (grep check; variant selectors and arbitrary CSS properties are exempt per the user's rule).
16. Submitting a multi-day booking (`dateFrom !== dateTo`) results in column A being a **TEXT** cell (not DATE) — verifiable via Sheets API `GET .../values/{range}` with `valueRenderOption=FORMULA` returning a leading-apostrophe-prefixed string, **and** `spreadsheets.get` returning `effectiveFormat.numberFormat.type === 'TEXT'` for that cell. A single-day booking stays as a **DATE** cell.
17. On API boot pointed at a sheet whose K1 headers match `EXPECTED_HEADERS` exactly, the process logs one structured `"boot.headers.ok"` line and serves `/api/bookings` normally. Pointed at a sheet with one header mutated (e.g. `"Готовнсть"` typo in column I), the HTTP listener still binds, both `GET /healthz` and `POST /api/bookings` return **HTTP 503** with body `{ ok: false, error: 'unavailable', reason: 'headers_mismatch', column_index: 8, expected: 'Готовность', observed: 'Готовнсть' }`, and exactly one `"boot.headers.mismatch"` structured log line is emitted at startup (not per-request). The process does not exit; recovery requires restarting after correcting either the sheet or `EXPECTED_HEADERS`.
18. Two `POST /api/bookings` requests with the **same** `Idempotency-Key` header within 5 minutes produce **one** new sheet row and **two identical** response bodies — the second response has `idempotent: true`. Two requests with **different** keys (or the same key after the 5-minute TTL) produce two rows.

---

## 10. Test plan (SHORT mode)

### Unit tests (Vitest, in each package)

- `packages/shared` (Vitest suites under `packages/shared/test/`):
  - `booking.test.ts` — `bookingSchema` accepts a valid payload; rejects bad time and bad date; the `.transform()` surfaces a `phone` ZodIssue for unparseable input; `dateTo < dateFrom` is rejected via parsed-Date compare (covers cross-month/cross-year cases like `dateFrom = 30.12.2025`, `dateTo = 02.01.2026` accepted, and the reverse rejected); **`dateFrom === dateTo` → parsed output has `dateTo: undefined` (single-day collapse)** and `bookingToRow()` on that output yields a DATE cell in column A (no leading apostrophe), matching the no-toggle path byte-for-byte.
  - `phone.test.ts` — `normalizePhone()` returns `''` on empty; turns `8 999 123 45 67`, `+7 (999) 123-45-67`, `7-999-123-45-67`, and `89991234567` all into `+79991234567`; throws on `'123'`, `'+8 999 …'`, `'+7 999 1234'` (wrong length), and a 10-digit no-prefix string.
  - `date.test.ts` — `parseDdmmyyyy('30.12.2025')` returns a Date with UTC year 2025 / month 11 (0-indexed) / day 30; round-trips correctly across DST and year boundaries.
  - `sheet-row.test.ts` — `bookingToRow()` produces exactly 11 cells in A..K order; single-day puts a bare `DD.MM.YYYY` in cell A; multi-day puts a leading-apostrophe-prefixed `'DD.MM.YYYY-DD.MM.YYYY` string in cell A; `EXPECTED_HEADERS.length === 11` and column K reads `'Ответсвенный'` (typo guard test).

- `apps/api`:
  - Env parser fails fast on missing vars; throws scrub `GOOGLE_SERVICE_ACCOUNT_JSON_B64` to `[REDACTED]`.
  - URL builder for `values.append` URI-encodes `Запись 2026` correctly.
  - `bookingToRow` is exercised end-to-end with the Sheets client **mocked** (no live API calls in CI).
  - Boot-time header verification: mocked Sheets client returning `EXPECTED_HEADERS` → emits `boot.headers.ok` and `bootState === 'ok'`; mocked client returning a mutated row → emits exactly one `boot.headers.mismatch` (with correct `column_index`, `expected`, `observed`), sets `bootState === 'headers_mismatch'`, and the HTTP listener still binds. Subsequent `GET /healthz` and `POST /api/bookings` both return 503 with the `unavailable` body shape (no `process.exit`, no per-request log lines for the short-circuit path). Spy on `process.exit` confirms it is **not** called.
  - Idempotency: two route invocations with the same `Idempotency-Key` produce one Sheets-client call and two identical results; the second carries `idempotent: true`. After advancing fake timers past 5 minutes, a third invocation re-hits the Sheets client.
  - Observability: a single POST emits one pino log line whose JSON contains all required fields (`request_id`, `sheets_latency_ms`, `sheets_status_code`, `idempotent`, `validation_failed`, `status`); response carries `X-Request-Id` matching the log's `request_id`.

- `apps/web`: skip unit tests of components in MVP — vee-validate + zod schema is already validated by the shared package tests.

### Manual verification

- Run all 18 acceptance criteria above against a real Railway deploy with the real sheet, end-to-end. Owner's phone, real submission. Criteria 16–18 require a Sheets API `GET` (cell format inspection), a deliberate header mutation in a scratch copy of the sheet, and a `curl` script that fires the same `Idempotency-Key` twice.

### No e2e infra

Playwright / Cypress is **not** worth the configuration cost for one form with one happy path. Acceptance criteria 4–9 are explicit manual checks. We will revisit this once we add edit/list flows.

---

## 11. Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **No auth → anyone with the URL writes rows.** | High | **Accepted risk, not mitigated.** `noindex` + `robots.txt` only stop search-engine indexing — they do not restrict access. An obscure Railway subdomain is security-through-obscurity. CORS is a UX control, not access control (see §5). Compensating control: structured logs (§5 Observability) make abuse visible within minutes — `request_id`, `idempotent`, `sheets_status_code` per request. Real mitigation is the auth follow-up — deferred deliberately, time-boxed. |
| **Service-account JSON key leakage.** | High | Stored only as a Railway env var (encrypted at rest); `.env` gitignored; `.env.example` ships placeholders; README forbids checking in real keys. Scope limited to `auth/spreadsheets` (no Drive, no full account). Key is rotatable in 60s via GCP console. |
| **Header spelling drift (`Ответсвенный` → `Ответственный`).** | Low | We never reference headers, only column **positions** (A..K). If the owner fixes the typo the boot-time header verification (§7) will fail-fast — `EXPECTED_HEADERS` pins the typo verbatim. Mitigation: update `EXPECTED_HEADERS` in the same PR that accepts the new sheet header. |
| **Column reorder or column insertion by owner editing the sheet directly.** | High | Boot-time header verification (§7) reads `A1:K1` on start. On mismatch the API **refuses to serve traffic**: the HTTP listener still binds (Railway sees a healthy process and does not enter a crash-loop), but both `/healthz` and `POST /api/bookings` return **HTTP 503** with the `unavailable` body shape from §5 (`reason: 'headers_mismatch'`, `column_index`, `expected`, `observed`) until the operator restarts after fixing the sheet or `EXPECTED_HEADERS`. Exactly one structured `boot.headers.mismatch` log line is emitted at startup. Open follow-up: a daily CI smoke check pinging the live header range so drift is caught while the API is **not** being redeployed. |
| **Sheets API quota / rate limits.** | Low | 60 writes/min/user — one booking is one write. We're orders of magnitude under. Graceful 502 from the API surfaces the toast retry. |
| **Date locale parsing in Sheets.** | Medium | Setup docs explicitly require sheet locale = Russia so `DD.MM.YYYY` parses as a date, not a string. `USER_ENTERED` does the parsing in Sheets, not in our code, so we inherit the spreadsheet's locale rules — predictable. |
| **Duplicate submission (double-tap, retry button).** | Medium | Server-side idempotency key (§5). Client generates UUID v4 at form-mount; reuses it on every retry until first success. In-memory TTL map on the API dedupes within 5 minutes — a repeated key returns the cached response without re-writing to Sheets and sets `idempotent: true`. After TTL expires, or across process instances, a re-submit accepts a second write — acceptable given a single Railway instance for MVP. **Note: Railway's default rolling deploy keeps the old and new instances live simultaneously for ~30 seconds while the new revision's healthcheck stabilises — a retry that lands on different instances inside that window will produce two rows because the in-memory map is not shared. Accepted as a known MVP deploy-window; Redis-backed idempotency (§12 follow-up 6) closes it.** |
| **Empty `MASTERS` enum.** | Low | Form renders Мастер as a free-text input until the enum is populated. No code change required when enum is filled in. |
| **Idempotency-Key roll on form re-mount during network retry.** | Low | The UUID v4 lives in client memory bound to the form-mount lifecycle. If the user closes the tab or hard-refreshes mid network-retry and re-submits from a fresh mount, a new key is generated and the second submission is treated as a brand-new request — no client-side dedupe. Accepted for MVP: the owner sees the duplicate row immediately at the bottom of the sheet and deletes it in one tap. Real fix requires persisting the key in `sessionStorage` against a content-hash of the payload — out of scope. |
| **Service-account JSON too large for Railway env UI.** | Low | Base64 encoding produces a single line; well below Railway's 64 KB env-value limit. |

---

## 12. ADR

**ADR-001: Two-service Railway deploy with a shared zod contract.**

- **Decision.** Build the MVP as `apps/web` (Vue 3 + Vite + shadcn-vue) and `apps/api` (Hono on `@hono/node-server`), deployed as two Railway services, with `packages/shared` exporting a single zod schema consumed on both sides.
- **Drivers.** (1) Owner ships and uses today; (2) schema fidelity with a live, in-use sheet; (3) reversibility — must accommodate week-2 features (auth, list, edit) without rewrite.
- **Alternatives considered.**
  - *Single-service Hono serving Vue build assets.* Lower infra surface but couples deploys and harms the planned auth-introduction path.
  - *Frontend + serverless function for the Sheets write.* Invalidated by the hard constraint of Hono-on-Node + Railway.
  - *Reading dropdown options from Sheets at runtime.* Adds a synchronous cold-start dependency for zero MVP value. Deferred.
  - *PWA on day one.* Adds service-worker complexity (cache invalidation, offline form replay) with no user-stated need. Deferred.
- **Why chosen.** Cleanest evolution path: when we add auth, list, and edit views, the split is what we want; the CORS overhead is one line; the shared zod contract eliminates the most common monorepo bug (silent DTO drift).
- **Consequences.**
  - Two Railway services to manage and bill.
  - One CORS configuration to keep in sync with the deployed web URL.
  - A `Booking` schema change requires the API to redeploy before the web does (or vice versa) — small ordering discipline.
  - A `@detailing/shared` import path becomes part of both apps' tsconfig — locks us to pnpm workspaces for the foreseeable future, which is fine.
- **Follow-ups.**
  1. Add owner-only auth (passcode middleware or Google OAuth) — issue filed at ship-day +0.
  2. Add list view (`GET /api/bookings?date=today`) once write path is proven.
  3. Daily CI smoke check pinging the live `A1:K1` header range so column drift is caught between deploys (complements the boot-time verification in §7).
  4. Re-evaluate dropdown-source decision (hardcoded → runtime) once a 2nd enum changes.
  5. Add PWA manifest + maskable icon once the owner asks to "install" the page on the home screen.
  6. Promote in-memory idempotency dedupe to a shared store (Redis) once a second API instance exists.

---

## 13. Out of scope for this iteration

- Reading existing bookings (`GET /api/bookings`).
- Editing or deleting bookings.
- A list / "Today's bookings" view.
- Cross-instance idempotency (single Railway instance — the in-memory map in §5 is sufficient for MVP; a Redis-backed shared store is out of scope until a second instance exists).
- Analytics, reporting, revenue dashboards.
- Multi-year support — we target `Запись 2026` only; `SHEET_NAME` env is the lever for the eventual switch.
- Authentication / authorization.
- PWA manifest, offline mode, service worker.
- E2E / Playwright test infrastructure.
- Internationalization — the app is Russian-only.
- Phone number international support — `+7` only by design.
- Audit log of who edited what (we have no "who").
- Image / file uploads (e.g. before/after photos of the car).

---

Status: pending approval
