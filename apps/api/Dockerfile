# ── Stage 1: install all dependencies ────────────────────────────────────────
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace manifests first — layer-cache for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build API ────────────────────────────────────────────────────────
FROM deps AS builder

# Copy full source
COPY . .

# Compile @detailing-admin/api (tsup → apps/api/dist/)
# @detailing-admin/shared is bundled via noExternal, no separate build step needed
RUN pnpm -F @detailing-admin/api build

# ── Stage 3: prune to production deps ─────────────────────────────────────────
FROM builder AS pruner

RUN pnpm prune --prod

# ── Stage 4: minimal runtime image ────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Production node_modules (hoisted by pnpm)
COPY --from=pruner /app/node_modules ./node_modules

# Compiled API bundle
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
