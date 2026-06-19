# ── Next.js build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Dictionary fetch stage ──────────────────────────────────────────────────
# The Afrikaans dictionary is read-only application data. The pinned release is
# defined once in dict.env (single source of truth, shared with the CI
# workflows) and baked into the image here. Override for a custom DB by passing
# --build-arg DICT_URL=... --build-arg DICT_SHA256=... (both default to the pin
# in dict.env when left empty).
#
# Examples:
#   docker build .                                   # pinned dict from dict.env
#   docker build \
#     --build-arg DICT_URL=https://cdn.example.com/lector/my-dict.db \
#     --build-arg DICT_SHA256=$(sha256sum my-dict.db | awk '{print $1}') .
FROM alpine:3 AS dict
ARG DICT_URL=
ARG DICT_SHA256=
RUN apk add --no-cache curl
COPY dict.env /tmp/dict.env
RUN set -e; \
    OVERRIDE_URL="${DICT_URL}"; OVERRIDE_SHA="${DICT_SHA256}"; \
    . /tmp/dict.env; \
    URL="${OVERRIDE_URL:-https://github.com/heuwels/lector/releases/download/${DICT_VERSION}/dictionary-af.db}"; \
    SHA="${OVERRIDE_SHA:-${DICT_SHA256}}"; \
    mkdir -p /dict; \
    echo "Fetching dictionary from: ${URL}"; \
    curl -fL --retry 3 "${URL}" -o /dict/dictionary-af.db; \
    if [ -n "${SHA}" ]; then \
      echo "${SHA}  /dict/dictionary-af.db" | sha256sum -c -; \
    else \
      echo "WARNING: no SHA-256 to verify against — skipping integrity check"; \
    fi

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
# Dictionary lives outside DATA_DIR so a user volume mount on /app/data
# doesn't shadow the read-only DB shipped with the image.
ENV DICT_DIR=/app/dict

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data + dict directories
RUN mkdir -p /app/data/books /app/dict \
 && chown -R nextjs:nodejs /app/data /app/dict

# Pull in the dictionary built in the `dict` stage
COPY --from=dict /dict/dictionary-af.db /app/dict/dictionary-af.db

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
