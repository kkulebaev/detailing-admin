# ── Этап 1: установка всех зависимостей workspace ────────────────────────────
FROM node:26-alpine AS deps

RUN npm install -g pnpm@12.15.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Этап 2: сборка web ───────────────────────────────────────────────────────
FROM deps AS builder

# Весь исходный код — фильтруется .dockerignore (без .env и node_modules хоста)
COPY . .

RUN pnpm -F @detailing-admin/web build

# ── Этап 3: раздача статической сборки и проксирование /api ──────────────────
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime

# Railway назначает PORT в рантайме; 8080 — запасной вариант для простого `docker run`.
ENV PORT=8080
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Без фильтра envsubst раскрыл бы и любую переменную nginx, имя которой случайно
# совпадает с переменной окружения.
ENV NGINX_ENVSUBST_FILTER='^(PORT|VITE_API_PROXY_TARGET|NGINX_LOCAL_RESOLVERS)$'

COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/web/nginx/05-api-target.envsh /docker-entrypoint.d/05-api-target.envsh
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
