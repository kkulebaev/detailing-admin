# Auth runbook (API)

Stateless JWT (HS256) in an httpOnly cookie. Roles: `admin`, `employee`.
Full design: `.omc/plans/auth-rbac-plan.md`.

## Env

| Var | Required | Default | Notes |
|-----|:--------:|---------|-------|
| `JWT_SECRET` | ✅ | — | ≥32 chars. Boot aborts if unset. `openssl rand -base64 48` |
| `AUTH_COOKIE_SECURE` | | `false` | `true` in prod (https, first-party) |
| `AUTH_COOKIE_SAMESITE` | | `lax` | `none` only for split-origin fallback |
| `AUTH_TOKEN_TTL_SECONDS` | | `86400` | 24h; sliding refresh on `GET /me` |

## Provisioning accounts

No self-registration. Accounts are created via CLI. Both scripts read `.env` when
present (local dev) and otherwise use the ambient process env (containers).

```bash
# local (loads apps/api/.env)
pnpm --filter @detailing-admin/api user:create --login admin --role admin
pnpm --filter @detailing-admin/api user:reset-password --login admin
```

Password is entered interactively (hidden), min 8 chars.

### Prod: bootstrap the first admin

Railway has no `.env`; env comes from the service. `railway run` injects it:

```bash
railway run pnpm --filter @detailing-admin/api user:create --login <admin> --role admin
```

Without this step nobody can log in — a fresh DB has zero users.

## Endpoints (`/api/auth`, all `Cache-Control: no-store`)

| Route | Auth | DB | Behaviour |
|-------|------|:--:|-----------|
| `POST /login` | public | ✅ | 200 + Set-Cookie on success; single 401 for bad login/password (dummy scrypt on unknown login); 503 if DB down |
| `POST /logout` | public | — | clears cookie, idempotent |
| `GET /me` | cookie | — | 200 `{user}` (stateless, no DB) + sliding refresh; 401 otherwise |
| `POST /change-password` | session | ✅ | 200; 400 on wrong current password; 409 on lost concurrent-change race; 503 if DB down |

All other `/api/*` routes require `requireAuth` + `requireAdmin` (admin-only MVP).
`requireAuth` is stateless (no DB), so the booking flow keeps working for
logged-in users when Postgres is down.
