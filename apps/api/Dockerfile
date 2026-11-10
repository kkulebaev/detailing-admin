# ── Этап 1: установка всех зависимостей ──────────────────────────────────────
FROM node:26-alpine AS deps

RUN npm install -g pnpm@12.15.0

WORKDIR /app

# Сначала копируем манифесты workspace — кэш слоя для pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Этап 2: сборка API ────────────────────────────────────────────────────────
FROM deps AS builder

# Копируем весь исходный код (фильтруется .dockerignore — без .env и node_modules хоста)
COPY . .

# Компилируем @detailing-admin/api (tsup → apps/api/dist/)
# @detailing-admin/shared вшивается через noExternal, отдельная сборка не нужна
RUN pnpm -F @detailing-admin/api build

# ── Этап 3: самодостаточная прод-сборка ──────────────────────────────────────
# `pnpm deploy` — корректный для workspace способ получить только прод-node_modules:
# `pnpm prune --prod` в монорепах молча сносит симлинки отдельных пакетов
# (выживает только корневое хранилище .pnpm, и Node не может разрезолвить, например,
# @hono/node-server из dist/main.js). deploy выдает плоскую директорию с
# package.json + node_modules + исходниками/dist пакета, с поднятыми зависимостями.
FROM builder AS deployer

ENV CI=true
RUN pnpm deploy --filter=@detailing-admin/api --prod /deploy/api

# ── Этап 4: минимальный образ для запуска ────────────────────────────────────
FROM node:26-alpine AS runtime

WORKDIR /app

# Самодостаточно: в выводе deploy есть package.json, node_modules (только прод)
# и собранный dist/. Корневые node_modules и файлы workspace в рантайме не нужны.
COPY --from=deployer --chown=node:node /deploy/api ./

# Сбрасываем привилегии — пользователь `node` (uid 1000) есть в официальных образах node
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
