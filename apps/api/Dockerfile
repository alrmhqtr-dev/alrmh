# Multi-stage Dockerfile for @alrmh/api (pnpm workspace).
# Build with the monorepo root as context:
#   docker build -f apps/api/Dockerfile -t alrmh-api .

# ─── Base: Node 24 + pnpm (version pinned by package.json#packageManager) ─
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Workspace manifests only — keeps the dependency layers cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY apps/mobile/package.json ./apps/mobile/

# ─── Stage 1: build ─────────────────────────────────────────────────────
FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@alrmh/api..." --filter alrmh
COPY turbo.json ./
COPY apps/api ./apps/api
RUN pnpm exec turbo run build --filter=@alrmh/api

# ─── Stage 2: production dependencies only ─────────────────────────────
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@alrmh/api..."

# ─── Stage 3: runtime ───────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

# pnpm links dependencies through each package's own node_modules into the
# store under /app/node_modules/.pnpm, so keep the same layout.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
# The SQL migrations that dist/migrate.js applies (Railway's pre-deploy command).
COPY --from=build /app/apps/api/sql ./apps/api/sql
# Photos for the sample products, added by the seed when a product has none.
COPY --from=build /app/apps/api/seed ./apps/api/seed

RUN chmod -R a+rX /app
USER app
EXPOSE 4000
WORKDIR /app/apps/api

# PORT is injected by the platform (Railway); 4000 is the local default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch(\`http://127.0.0.1:\${process.env.PORT||4000}/health/live\`).then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Railway's pre-deploy command: `node dist/migrate.js`
CMD ["node", "dist/main.js"]
