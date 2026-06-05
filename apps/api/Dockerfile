# ── Stage 1: install all dependencies ────────────────────────────────────────
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

WORKDIR /app

# Copy workspace manifests first — layer-cache for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build API ────────────────────────────────────────────────────────
FROM deps AS builder

# Copy full source (filtered by .dockerignore — no .env, no host node_modules)
COPY . .

# Compile @detailing-admin/api (tsup → apps/api/dist/)
# @detailing-admin/shared is bundled via noExternal, no separate build step needed
RUN pnpm -F @detailing-admin/api build

# ── Stage 3: produce a self-contained prod deployment ────────────────────────
# `pnpm deploy` is the workspace-correct way to get prod-only node_modules:
# `pnpm prune --prod` silently nukes per-package symlinks in monorepos
# (only the root .pnpm store survives, leaving Node unable to resolve e.g.
# @hono/node-server from dist/main.js). deploy outputs a flat directory with
# package.json + node_modules + the package source/dist, hoisted.
FROM builder AS deployer

ENV CI=true
# --legacy keeps deploy using the symlink layout (vs pnpm 10+'s default
# injected-workspaces). /.npmrc also sets force-legacy-deploy=true as a
# fallback for when --legacy is eventually removed, but pnpm 11.1.1 does not
# reliably honor that key — keep the explicit flag here.
RUN pnpm deploy --filter=@detailing-admin/api --prod --legacy /deploy/api

# ── Stage 4: minimal runtime image ────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

# Self-contained: deployer output has package.json, node_modules (prod only),
# and the built dist/. No root node_modules or workspace files needed at runtime.
COPY --from=deployer --chown=node:node /deploy/api ./

# Drop privileges — `node` user (uid 1000) ships with the official node images
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
