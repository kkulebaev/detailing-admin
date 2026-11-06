# ── Stage 1: install all workspace dependencies ──────────────────────────────
FROM node:26-alpine AS deps

RUN npm install -g pnpm@12.15.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build web ───────────────────────────────────────────────────────
FROM deps AS builder

# Full source — filtered by .dockerignore (no .env, no host node_modules)
COPY . .

RUN pnpm -F @detailing-admin/web build

# ── Stage 3: serve the static build and proxy /api ───────────────────────────
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime

# Railway assigns PORT at runtime; 8080 is the fallback for a plain `docker run`.
ENV PORT=8080
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Without the filter envsubst would also expand any nginx variable that happens to
# share a name with an environment variable.
ENV NGINX_ENVSUBST_FILTER='^(PORT|VITE_API_PROXY_TARGET|NGINX_LOCAL_RESOLVERS)$'

COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/web/nginx/05-api-target.envsh /docker-entrypoint.d/05-api-target.envsh
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
