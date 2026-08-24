# ── Next.js build stage ──
FROM node:22-alpine AS builder

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
ENV APP_VERSION=$APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

# ── Dictionary fetch stage ──────────────────────────────────────────────────
# On-device dictionaries are read-only application data. Pins live once in
# dict.env (single source of truth, shared with the CI workflows and now with
# the runtime): per language DICT_VERSION_<LANG> + DICT_SHA256_<LANG>, with
# DICT_LANGS listing the published set.
#
# This stage bakes NOTHING by default (#438). The published image ships dict.env
# and downloads the databases the box actually asks for, into a volume on
# DICT_DIR. Twenty pinned languages are about 2.6 GB, and a learner studies one
# or two of them.
#
# Set the BAKE_DICTS build arg to put databases back in the image:
#   docker build .                                   # slim: no databases (default)
#   docker build --build-arg BAKE_DICTS=all .        # the `:full` tag, every language
#   docker build --build-arg BAKE_DICTS="af de" .    # explicit subset
#   docker build \
#     --build-arg DICT_URL=https://cdn.example.com/lector/my-dict.db \
#     --build-arg DICT_SHA256=$(sha256sum my-dict.db | awk '{print $1}') .
#
# A baked image is self-sufficient offline. Pair it with DICT_FETCH=0 so the
# runtime loop never reaches for GitHub.
FROM alpine:3 AS dict
ARG DICT_URL=
ARG DICT_SHA256=
ARG DICT_LANG=af
ARG BAKE_DICTS=
# DICT_LANGS was the build arg that chose which dictionaries to bake. It is a
# RUNTIME variable now (#438), and a build that still passes it would silently
# produce a slim image. Fail instead, and say what replaced it.
ARG DICT_LANGS=
RUN apk add --no-cache curl
COPY dict.env /tmp/dict.env
RUN set -e; \
    if [ -n "${DICT_LANGS}" ]; then \
      echo "ERROR: --build-arg DICT_LANGS is gone (#438). Dictionaries are fetched at runtime now." >&2; \
      echo "       To bake them into the image, use --build-arg BAKE_DICTS=\"${DICT_LANGS}\" (or BAKE_DICTS=all)." >&2; \
      echo "       To choose languages on a running box, set the DICT_LANGS environment variable." >&2; \
      exit 1; \
    fi; \
    BAKE="${BAKE_DICTS}"; \
    mkdir -p /dict; \
    if [ -n "${DICT_URL}" ]; then \
      echo "Fetching override ${DICT_LANG} dictionary from: ${DICT_URL}"; \
      curl -fL --retry 3 "${DICT_URL}" -o "/dict/dictionary-${DICT_LANG}.db"; \
      if [ -n "${DICT_SHA256}" ]; then \
        echo "${DICT_SHA256}  /dict/dictionary-${DICT_LANG}.db" | sha256sum -c -; \
      else \
        echo "WARNING: no SHA-256 to verify against — skipping integrity check"; \
      fi; \
      printf '{"%s":{"version":"unmanaged","sha256":"","installedAt":""}}\n' \
        "${DICT_LANG}" > /dict/installed.json; \
    elif [ -z "${BAKE}" ]; then \
      echo "Slim image: no dictionaries baked. The runtime fetches them into DICT_DIR (#438)."; \
      printf '%s\n' \
        'This image ships no dictionaries. The API downloads the ones this box' \
        'asks for into DICT_DIR and records them in installed.json (#438).' \
        'Set DICT_LANGS to pre-fetch at boot, or use the :full tag for an' \
        'offline install. This file only keeps the directory non-empty.' \
        > /dict/README-slim.txt; \
    else \
      . /tmp/dict.env; \
      if [ "${BAKE}" = "all" ]; then LANGS="${DICT_LANGS}"; else LANGS="${BAKE}"; fi; \
      echo "Baking dictionaries for: ${LANGS}"; \
      ENTRIES=""; \
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
        if [ -n "${ENTRIES}" ]; then ENTRIES="${ENTRIES},"; fi; \
        ENTRIES="${ENTRIES}\"${L}\":{\"version\":\"${VER}\",\"sha256\":\"${DSHA}\",\"installedAt\":\"\"}"; \
      done; \
      printf '{%s}\n' "${ENTRIES}" > /dict/installed.json; \
    fi

# ── Bun API build stage ──
FROM oven/bun:1-alpine AS api-builder

WORKDIR /api

COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY api/src ./src

# ── Production stage ──
FROM node:22-alpine AS runner

WORKDIR /app

# Copy Bun binary from the official image
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

# eSpeak NG — the self-hosted TTS engine for languages without a Google voice
# (Esperanto, #307 §3.2c). A few-MB formant synthesizer invoked by the API as
# an arm's-length subprocess (api/src/routes/tts.ts); GPL obligations don't
# attach because nothing GPL is distributed with, or linked into, Lector code.
# ffmpeg supplies ffprobe for the audio-import duration probe (#185) — same
# arm's-length subprocess posture (api/src/lib/audio-probe.ts). Whisper itself
# is deliberately NOT in this image: transcription talks to an external
# OpenAI-compatible ASR server via ASR_URL (in-container Whisper would be
# CPU-only inside Docker's VM — slow, and it pins the cores Lector shares).
RUN apk add --no-cache espeak-ng ffmpeg

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data
# Dictionaries live outside DATA_DIR so a user volume mount on /app/data does
# not shadow them. They are no longer read-only image content: the runtime
# downloads them here (#438), so mount a volume on /app/dict or they are lost
# on every image pull. docker-compose.yml does that with a named volume.
ENV DICT_DIR=/app/dict

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data + dict directories
RUN mkdir -p /app/data/books /app/dict \
 && chown -R nextjs:nodejs /app/data /app/dict

# Pull in whatever the `dict` stage produced. The slim default is one README,
# because a COPY needs a source that is not empty. Docker seeds a fresh named
# volume from this directory on first run, so a `:full` image hands its baked
# dictionaries to the volume and the runtime then leaves them alone.
COPY --from=dict /dict/ /app/dict/

# The pin manifest the runtime fetch verifies against (#438). It resolves as
# /app/dict.env, one level up from the API's working directory.
COPY dict.env ./dict.env

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
