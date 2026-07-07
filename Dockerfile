# ── Next.js build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build/version metadata for Settings → About. The build context has no .git
# (see .dockerignore), so these are supplied by the callers that do have it —
# the docker.yml / release.yml workflows and deploy.sh — and read by
# next.config.ts. Declared after `COPY . .` (which already invalidates per
# commit) so they don't bust the cached `npm ci` layer. BUILD_TIME is omitted on
# purpose: next.config stamps it via `new Date()` during `npm run build`.
ARG APP_VERSION=
ARG GIT_COMMIT=
ARG GIT_BRANCH=
ENV APP_VERSION=$APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT
ENV GIT_BRANCH=$GIT_BRANCH
RUN npm run build

# ── Dictionary fetch stage ──────────────────────────────────────────────────
# On-device dictionaries are read-only application data. Pins live once in
# dict.env (single source of truth, shared with the CI workflows): per language
# DICT_VERSION_<LANG> + DICT_SHA256_<LANG>, with DICT_LANGS listing the published
# set. ALL selected languages are fetched (GitHub release, sha256-verified) and
# baked into the SAME image — one image serves every bundled language at runtime.
#
# Select which languages to bake with --build-arg DICT_LANGS="…" (space-separated;
# must be a subset of the languages pinned in dict.env). Defaults to dict.env's
# DICT_LANGS = every published language. Override a single DB with
# --build-arg DICT_URL=... (+ optional DICT_SHA256=, DICT_LANG=; lang defaults to af).
#
# Examples:
#   docker build .                                   # all published dicts (af + de + es + fr)
#   docker build --build-arg DICT_LANGS="de" .       # German-only image (smaller)
#   docker build --build-arg DICT_LANGS="af de" .    # explicit subset
#   docker build \
#     --build-arg DICT_URL=https://cdn.example.com/lector/my-dict.db \
#     --build-arg DICT_SHA256=$(sha256sum my-dict.db | awk '{print $1}') .
FROM alpine:3 AS dict
ARG DICT_URL=
ARG DICT_SHA256=
ARG DICT_LANG=af
ARG DICT_LANGS=
RUN apk add --no-cache curl
COPY dict.env /tmp/dict.env
RUN set -e; \
    OVERRIDE_LANGS="${DICT_LANGS}"; \
    mkdir -p /dict; \
    if [ -n "${DICT_URL}" ]; then \
      echo "Fetching override ${DICT_LANG} dictionary from: ${DICT_URL}"; \
      curl -fL --retry 3 "${DICT_URL}" -o "/dict/dictionary-${DICT_LANG}.db"; \
      if [ -n "${DICT_SHA256}" ]; then \
        echo "${DICT_SHA256}  /dict/dictionary-${DICT_LANG}.db" | sha256sum -c -; \
      else \
        echo "WARNING: no SHA-256 to verify against — skipping integrity check"; \
      fi; \
    else \
      . /tmp/dict.env; \
      LANGS="${OVERRIDE_LANGS:-${DICT_LANGS}}"; \
      echo "Baking dictionaries for: ${LANGS}"; \
      for L in ${LANGS}; do \
        U=$(echo "$L" | tr a-z A-Z); \
        eval "VER=\${DICT_VERSION_${U}:-}"; \
        eval "DSHA=\${DICT_SHA256_${U}:-}"; \
        if [ -z "${VER}" ]; then \
          echo "ERROR: no DICT_VERSION_${U} pin in dict.env for requested language '${L}'" >&2; \
          exit 1; \
        fi; \
        URL="https://github.com/heuwels/lector/releases/download/${VER}/dictionary-${L}.db"; \
        echo "Fetching ${L} dictionary from: ${URL}"; \
        curl -fL --retry 3 "${URL}" -o "/dict/dictionary-${L}.db"; \
        if [ -n "${DSHA}" ]; then \
          echo "${DSHA}  /dict/dictionary-${L}.db" | sha256sum -c -; \
        else \
          echo "WARNING: no SHA-256 for ${L} — skipping integrity check"; \
        fi; \
      done; \
    fi

# ── Bun API build stage ──
FROM oven/bun:1-alpine AS api-builder

WORKDIR /api

COPY api/package.json api/bun.lock* ./
RUN bun install --production

COPY api/src ./src

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

# Pull in the dictionaries fetched in the `dict` stage (one per DICT_LANGS entry)
COPY --from=dict /dict/ /app/dict/

# Copy Next.js standalone build
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Hono API
COPY --from=api-builder /api ./api

# Shared language registry the API imports at runtime
# (api/src/lib/languages.ts → ../../../languages → /app/languages).
COPY languages ./languages

# Copy entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000 3457

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "./docker-entrypoint.sh"]
