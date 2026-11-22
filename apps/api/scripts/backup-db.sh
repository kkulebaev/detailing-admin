#!/usr/bin/env bash
#
# Снимает полный дамп БД в файл перед рискованной операцией над данными (backfill и т. п.).
#
#   pnpm --filter @detailing-admin/api db:backup            # прод: PROD_DATABASE_URL
#   BACKUP_DATABASE_URL=… pnpm --filter @detailing-admin/api db:backup
#
# Дамп в custom-формате (-Fc) ложится в apps/api/.backups/ (в .gitignore): в нем PII
# клиентов, удалите файл, когда он перестанет быть нужен. Восстановление в пустую БД:
#   pg_restore --no-owner --no-privileges -d <url> <файл>
#
# pg_dump запускается во временном контейнере postgres:18-alpine с --network host:
# из контейнера detailing-postgres при включенном VPN соединение с Railway виснет на TLS.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -z "${BACKUP_DATABASE_URL:-}" ]]; then
  if [[ -z "${PROD_DATABASE_URL:-}" && -f apps/api/.env.prod ]]; then
    set -a; . apps/api/.env.prod; set +a
  fi
  BACKUP_DATABASE_URL="${PROD_DATABASE_URL:-}"
fi
if [[ -z "$BACKUP_DATABASE_URL" ]]; then
  echo "✗ Set BACKUP_DATABASE_URL or PROD_DATABASE_URL (apps/api/.env.prod)." >&2
  exit 1
fi

DIR="apps/api/.backups"
mkdir -p "$DIR"
OUT="$DIR/detailing-$(date +%Y%m%d-%H%M%S).dump"

echo "→ dumping to $OUT…"
docker run --rm --network host -e DBURL="$BACKUP_DATABASE_URL" postgres:18-alpine \
  sh -c 'pg_dump "$DBURL" -Fc --no-owner --no-privileges' > "$OUT.partial"
mv "$OUT.partial" "$OUT"

# Проверка, что архив читается и в нем есть данные записей, а не только схема.
echo "→ verifying…"
TOC=$(docker run --rm -i postgres:18-alpine pg_restore --list < "$OUT")
for t in bookings booking_services booking_masters audit_log; do
  grep -q "TABLE DATA public $t " <<<"$TOC" || { echo "✗ no data for $t in $OUT" >&2; exit 1; }
done
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
