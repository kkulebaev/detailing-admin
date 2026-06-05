# ── Stage 1: install all workspace dependencies ──────────────────────────────
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build web ───────────────────────────────────────────────────────
FROM deps AS builder

# Full source — filtered by .dockerignore (no .env, no host node_modules)
COPY . .

RUN pnpm -F @detailing-admin/web build

# ── Stage 3: produce a self-contained deployment ─────────────────────────────
# No --prod here: vite (the preview server) is a devDep, so a prod-only deploy
# would strip it and break startup. `pnpm deploy` still hoists transitively and
# leaves out other workspaces' deps (googleapis, tsup, vitest, vue-tsc, …) which
# otherwise dominated the runtime image when we copied the root node_modules.
FROM builder AS deployer

ENV CI=true
# --legacy: see the matching comment in apps/api/Dockerfile.
RUN pnpm deploy --filter=@detailing-admin/web --legacy /deploy/web

# ── Stage 4: minimal runtime — vite preview ──────────────────────────────────
# NOTE: `vite preview` is documented as not-for-production. It works for this
# MVP, but when traffic grows, swap this stage for nginx:alpine serving
# /app/dist and drop the Node runtime entirely.
FROM node:24-alpine AS runtime

WORKDIR /app

# WORKDIR creates /app as root. Vite's config-loader may write to /app/.vite
# (esbuild scratch) when bundling vite.config.ts on preview startup.
RUN chown node:node /app

COPY --from=deployer --chown=node:node /deploy/web ./

USER node

# Production mode keeps Vue/plugins out of dev branches even though preview
# already defaults to mode=production.
ENV NODE_ENV=production

EXPOSE 8080

# Invoke vite directly via node — bypasses pnpm at runtime (its startup
# deps-status-check tries to `pnpm install` into /app and fails for the
# non-root user, plus corepack would re-download pnpm on each cold start).
# `exec` makes node PID 1 so SIGTERM from Railway reaches it directly.
CMD ["sh", "-c", "exec node node_modules/vite/bin/vite.js preview --port ${PORT:-8080} --host 0.0.0.0"]
