#!/usr/bin/env bash
#
# Sync a fresh dump of the production DB into the local docker Postgres.
#
#   pnpm --filter @detailing-admin/api db:sync-prod        # asks for confirmation
#   pnpm --filter @detailing-admin/api db:sync-prod --yes  # no prompt
#
# DESTRUCTIVE to the LOCAL db: it is dropped and recreated to mirror prod exactly.
# Prod is only ever READ (pg_dump). Both dump and restore run inside the local
# `postgres` container, so no pg_dump/psql on the host is needed (prod and local
# are the same major version).
#
# The prod connection string is NOT stored in the repo. Provide it as the
# PUBLIC proxy URL (…proxy.rlwy.net…, the internal *.railway.internal host does
# not resolve from your machine) via either:
#   • env var:  PROD_DATABASE_URL=… pnpm … db:sync-prod
#   • a gitignored file: apps/api/.env.prod  with  PROD_DATABASE_URL=…
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Local target — matches docker-compose.yml (POSTGRES_USER/DB=detailing).
LOCAL_USER=detailing
LOCAL_DB=detailing

# Resolve the prod URL: explicit env wins, else the gitignored .env.prod.
if [[ -z "${PROD_DATABASE_URL:-}" && -f apps/api/.env.prod ]]; then
  set -a; . apps/api/.env.prod; set +a
fi
if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
  cat >&2 <<'MSG'
✗ PROD_DATABASE_URL is not set.
  Put the prod PUBLIC connection string in apps/api/.env.prod:
      PROD_DATABASE_URL=postgresql://…@<region>.proxy.rlwy.net:<port>/railway
  (Railway → Postgres → Connect → Public Network. The …railway.internal host
   only works inside Railway, not from your machine.)
MSG
  exit 1
fi

# Confirm (destructive), unless -y/--yes.
if [[ "${1:-}" != "--yes" && "${1:-}" != "-y" ]]; then
  read -r -p "This WIPES the local '$LOCAL_DB' DB and replaces it with a fresh prod dump. Continue? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

echo "→ ensuring local postgres is up…"
docker compose up -d postgres >/dev/null
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$LOCAL_USER" -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "→ dropping & recreating local '$LOCAL_DB'…"
docker compose exec -T postgres psql -U "$LOCAL_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $LOCAL_DB WITH (FORCE);" \
  -c "CREATE DATABASE $LOCAL_DB OWNER $LOCAL_USER;" >/dev/null

echo "→ streaming prod dump → local (no file on disk)…"
# pg_dump (in container, reads prod) → host pipe → psql (in container, writes local).
docker compose exec -T postgres pg_dump "$PROD_DATABASE_URL" \
    --no-owner --no-privileges --no-comments \
  | docker compose exec -T postgres psql -U "$LOCAL_USER" -d "$LOCAL_DB" -q -v ON_ERROR_STOP=1 >/dev/null

echo "✓ synced. row counts:"
docker compose exec -T postgres psql -U "$LOCAL_USER" -d "$LOCAL_DB" -At -F $'\t' -c "
  SELECT 'bookings', count(*) FROM bookings
  UNION ALL SELECT 'booking_masters', count(*) FROM booking_masters
  UNION ALL SELECT 'clients', count(*) FROM clients
  UNION ALL SELECT 'client_cars', count(*) FROM client_cars
  UNION ALL SELECT 'masters', count(*) FROM masters
  UNION ALL SELECT 'services', count(*) FROM services
  ORDER BY 1;" | sed 's/^/  /'

echo "→ tip: restart the API (pnpm dev) so it re-reads _dbReady after the swap."
