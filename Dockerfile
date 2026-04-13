# ── Next.js build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Bun API build stage ──
FROM oven/bun:1-alpine AS api-builder

WORKDIR /api

COPY api/package.json api/bun.lock* ./
RUN bun install --production

COPY api/src ./src
# Replace symlink with actual file (symlink points outside build context)
RUN rm -f ./src/lib/sentence-bank.json
COPY src/lib/sentence-bank.json ./src/lib/sentence-bank.json

# ── Production stage ──
FROM node:20-alpine AS runner

WORKDIR /app

# Copy Bun binary from the official image
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data directories
RUN mkdir -p /app/data/books && chown -R nextjs:nodejs /app/data

# Copy Next.js standalone build
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy better-sqlite3 native module (still needed by Next.js API routes)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Copy Hono API
COPY --from=api-builder /api ./api

# Copy entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000 3457

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV API_PORT=3457

CMD ["sh", "./docker-entrypoint.sh"]
