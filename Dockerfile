# syntax=docker/dockerfile:1.6
# Multi-stage production image for Zene (Node >= 20, pure ESM).
# Local workspace packages (gateway-multiplex, zene-sdk) must be present before npm ci.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# System deps for native modules (better-sqlite3, etc.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests + local packages first so file: dependencies resolve during install
COPY package.json package-lock.json ./
COPY packages ./packages

RUN npm ci

# Remainder of the source tree
COPY . .

# Compile Core + copy plugin assets
RUN npm run slim-build

# Optional integrated dashboard UI (Vite). Failure here is non-fatal for API-only images;
# DashboardMode=true will refuse to start without the resulting dist.
WORKDIR /app/apps/web
RUN if [ -f package.json ]; then \
      npm ci && npm run build; \
    else \
      echo "apps/web not present — skipping dashboard UI build"; \
    fi
WORKDIR /app

# Ensure the dashboard asset path exists even when the UI build was skipped
RUN mkdir -p /app/apps/web/dist

# Drop build-only deps before copying into the runtime image
RUN npm prune --omit=dev


FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    TZ=UTC \
    DashboardMode=auto

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Runtime package tree (includes file: local packages + pruned node_modules)
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Compiled Core / plugins / entry
COPY --from=builder /app/core ./core
COPY --from=builder /app/index.js ./
COPY --from=builder /app/index.d.ts* ./
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/plugins ./plugins
COPY --from=builder /app/plugins.txt* ./
COPY --from=builder /app/takebacks.json* ./
COPY --from=builder /app/takebacks.example.json* ./
COPY --from=builder /app/common.json* ./

# Integrated dashboard assets (may be absent on API-only builds)
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN addgroup --system --gid 1001 zene \
 && adduser --system --uid 1001 --ingroup zene zene \
 && mkdir -p /app/.data /app/logs /app/configuration \
 && chown -R zene:zene /app

USER zene

EXPOSE 3000

# HttpServer exposes GET /health (not /api/health)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APIPort||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "--import", "./core/dependency/index.mjs", "./index.js"]