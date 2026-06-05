## Handoff: team-exec → team-verify

- **Decided**:
  - Monorepo materialised exactly per plan §3: `apps/web`, `apps/api`, `packages/shared`, pnpm workspaces, Node 22, no Turbo/Nx.
  - Shared zod schema + helpers (`booking.ts`, `date.ts`, `phone.ts`, `sheet-row.ts`, `enums.ts`, `api.ts`) with 35/35 Vitest tests. `EXPECTED_HEADERS` preserves the `Ответсвенный` typo verbatim.
  - API (Hono on `@hono/node-server`): boot-time header verification, `bootState='headers_mismatch'` + 503 from `/healthz` and `POST /api/bookings`, pino logs with PII redact, in-memory idempotency Map (5-min TTL), Service Account via `GOOGLE_SERVICE_ACCOUNT_JSON_B64`. 32/32 tests green, typecheck clean.
  - Web (Vue 3 + Vite + shadcn-vue): mobile-first form, phone field bound to raw masked string, special non-dismissable banner for `error: 'unavailable'`, `noindex` + `robots.txt`. Vite build clean (409 kB).
  - Deployment: `apps/api/railway.json` (RAILPACK, /healthz, ON_FAILURE), multi-stage `Dockerfile` (node:22-alpine), `apps/web/railway.json`, root README covers 9 sections including the mandatory "no surrounding quotes" warning and the sheet-locale instruction.
- **Rejected**:
  - Single combined Hono service serving Vue build — Option B from the plan, rejected at plan time.
  - Auth in MVP — accepted-risk per plan §11 row 1.
  - Reading dropdown options from sheet dataValidation — deferred per plan §13.
- **Risks for verify**:
  - `apps/web/src/**/*.{js,d.ts}` artefacts visible in the listing — `vue-tsc -b` likely emitted declarations during one of the type-check passes. Verifier should `grep -lr` for these and either confirm they are excluded from build output / gitignored, or have worker-web prune them.
  - We have **not** run the Sheets API end-to-end against a real spreadsheet — acceptance criteria 5, 6, 7, 8, 9, 13, 16, 17, 18 all require a live Sheet + service account. Verifier should mark these "manual verification required, blocked by GCP credentials" and pass everything that is checkable statically/in isolation.
  - Lockfile present at root (`pnpm-lock.yaml`) is the only one; the verifier should confirm no nested lockfiles were created in sub-packages.
- **Files** (top-level deliverables):
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `README.md`
  - `packages/shared/{package.json, tsconfig.json, vitest.config.ts, src/*, test/*}`
  - `apps/api/{package.json, tsconfig.json, .env.example, src/*, test/*, railway.json, Dockerfile}`
  - `apps/web/{package.json, tsconfig*.json, vite.config.ts, index.html, components.json, public/robots.txt, src/{main.ts,App.vue,styles/*,components/{BookingForm.vue,ui/*},lib/{api.ts,utils.ts}}, .env.example, railway.json}`
- **Remaining for verify**:
  1. Run the static gates: root `pnpm install`, `pnpm -r run typecheck`, `pnpm -r run test`, `pnpm -r run build`. Collect a single PASS/FAIL summary.
  2. Walk the 18 acceptance criteria from plan §9 and mark each ✅ / ⚠️ (live-sheet required) / ❌.
  3. Code-reviewer: check Conventional-Commit-readiness of the diff, no `Co-Authored-By` trailer, no secrets committed, Tailwind arbitrary-bracket grep is empty.
  4. Security-reviewer: env redaction is real (env.ts → error path), pino redact paths include `phone/name/note` and `*.GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `noindex`+`robots.txt` present, CORS allowlist is `WEB_ORIGIN` not `*`.
  5. If verifier reports defects → spin up team-fix loop (max_fix_loops=3). Otherwise: commit protocol per plan (one Conventional commit per logical chunk, no co-author, no push), then graceful team shutdown + cleanup.
