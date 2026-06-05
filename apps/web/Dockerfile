# ── Stage 1: install all workspace dependencies ──────────────────────────────
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build web ───────────────────────────────────────────────────────
FROM deps AS builder

COPY . .

RUN pnpm -F @detailing-admin/web build

# ── Stage 3: minimal runtime — vite preview ──────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/vite.config.ts ./apps/web/
COPY --from=builder /app/apps/web/tsconfig.json ./apps/web/
COPY --from=builder /app/apps/web/tsconfig.node.json ./apps/web/
COPY --from=builder /app/apps/web/index.html ./apps/web/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

EXPOSE 8080

CMD ["sh", "-c", "pnpm -F @detailing-admin/web preview -- --port ${PORT:-8080} --host 0.0.0.0"]
