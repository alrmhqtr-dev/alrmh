# Multi-stage Dockerfile for @alrmh/mobile, the customer app as a PWA.
# Build with the monorepo root as context:
#   docker build -f apps/mobile/Dockerfile -t alrmh-mobile .
#
# EXPO_PUBLIC_* values are written into the bundle at build time, so they are
# build arguments. Railway passes a service variable to the build only when it
# is declared here with ARG.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY apps/mobile/package.json ./apps/mobile/

# ─── Build: export the web app to dist/ ────────────────────────────────
FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@alrmh/mobile..." --filter alrmh

COPY turbo.json ./
COPY apps/mobile ./apps/mobile

ARG EXPO_PUBLIC_API_URL
ENV EXPO_NO_TELEMETRY=1
RUN test -n "$EXPO_PUBLIC_API_URL" || (echo "Set EXPO_PUBLIC_API_URL on the service" && exit 1)
RUN pnpm exec turbo run build --filter="@alrmh/mobile..."

# ─── Runtime: a static server with no dependencies ─────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=/app/dist

RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/mobile/dist ./dist
COPY --from=build --chown=app:app /app/apps/mobile/scripts/serve.mjs ./serve.mjs

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch(\`http://127.0.0.1:\${process.env.PORT}/healthz\`).then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "serve.mjs"]
