#!/usr/bin/env bash
#
# Заливает свежий дамп продовой БД в локальный docker-Postgres.
#
#   pnpm --filter @detailing-admin/api db:sync-prod        # спрашивает подтверждение
#   pnpm --filter @detailing-admin/api db:sync-prod --yes  # без вопроса
#
# РАЗРУШИТЕЛЬНО для ЛОКАЛЬНОЙ БД: она удаляется и создаётся заново как точная копия прода.
# Прод только ЧИТАЕТСЯ (pg_dump). И дамп, и восстановление идут внутри локального
# контейнера `postgres`, поэтому pg_dump/psql на хосте не нужны (у прода и локальной БД
# одна мажорная версия).
#
# Строка подключения к проду НЕ хранится в репозитории. Передайте ПУБЛИЧНЫЙ
# proxy URL (…proxy.rlwy.net…, внутренний хост *.railway.internal с вашей машины
# не резолвится) одним из способов:
#   • переменная окружения:  PROD_DATABASE_URL=… pnpm … db:sync-prod
#   • файл в .gitignore: apps/api/.env.prod  с  PROD_DATABASE_URL=…
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Локальная цель — совпадает с docker-compose.yml (POSTGRES_USER/DB=detailing).
LOCAL_USER=detailing
LOCAL_DB=detailing

# Определяем URL прода: явная переменная окружения важнее, иначе .env.prod из .gitignore.
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

# Подтверждение (операция разрушительная), если не передан -y/--yes.
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
# pg_dump (в контейнере, читает прод) → pipe на хосте → psql (в контейнере, пишет в локальную).
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
