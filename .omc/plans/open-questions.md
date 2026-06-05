# Open Questions

## mvp-booking-form — 2026-06-04

These were resolved in the plan but each carries a deferred re-decision point. Surface them again when a trigger condition fires.

- [ ] Authentication strategy (passcode vs Google OAuth vs Cloudflare Access) — **Why it matters:** no-auth window is a deliberate, time-boxed risk; choose before sharing the URL beyond the owner.
- [ ] Should Мастер list be hardcoded or read from sheet data-validation at runtime? — **Why it matters:** revisit the moment the second master is added, or when the owner edits the enum more than once a month.
- [ ] Source of `RESPONSIBLES` enum: shared package vs sheet `dataValidation` — **Why it matters:** same trigger as Мастер; consolidating both decisions is cheaper than doing one then the other.
- [x] ~~Server-side idempotency key on `POST /api/bookings`~~ — **Resolved (iteration 2):** in-memory `Idempotency-Key` TTL map (5 min) on the API; client generates UUID v4 at form-mount. Cross-instance variant tracked as a separate follow-up below.
- [ ] Cross-instance idempotency store (Redis or similar) — **Why it matters:** trigger when a second Railway API instance becomes necessary; in-memory map no longer dedupes across instances.
- [ ] Daily CI smoke check pinging live `A1:K1` headers — **Why it matters:** boot-time verification only catches drift on deploy; column reorders done between deploys go unnoticed until the next restart.
- [ ] Log retention / PII redaction policy for the pino stdout stream — **Why it matters:** logs currently exclude payload bodies by design (§5), but a future "log the full request on 502" temptation would leak `name`/`phone`/`note`. Pin the policy before any verbose-logging PR lands.
- [x] ~~Boot-mismatch policy: `process.exit(1)` vs 503-from-live-listener~~ — **Resolved (iteration 3):** live listener + 503 response from both `/healthz` and `POST /api/bookings`, single `boot.headers.mismatch` log at startup, `bootState` cleared only by process restart. Rationale: avoids Railway crash-loop / exponential-backoff state where no revision is healthy. See §7 "Boot-time header verification" and AC-17.
- [ ] Idempotency-Key roll on form re-mount during network retry — **Acknowledged for MVP.** Key is bound to form-mount lifecycle; closing the tab mid-retry and re-submitting from a fresh mount produces a duplicate row. Documented in §11. Trigger to revisit: first observed user complaint about a duplicate row from this exact path, or once `sessionStorage`-backed payload-hash → key persistence becomes cheaper than the duplicate-delete cost.
- [ ] PWA manifest + installable icon — **Why it matters:** decide when the owner first asks to "put it on the home screen" or when offline submission would actually help.
- [ ] Switch off `USER_ENTERED` to `RAW` for column H only? — **Why it matters:** only if Sheets' locale parsing ever mangles an amount; currently no evidence it does.
- [ ] Multi-year support strategy (e.g. `Запись 2027`) — **Why it matters:** late-2026 calendar lever; either env-var swap, year selector in the form, or auto-rotation based on the selected date.
- [ ] E2E test framework (Playwright?) — **Why it matters:** decide once the second feature (edit / list) lands and a single happy-path test is no longer sufficient.
