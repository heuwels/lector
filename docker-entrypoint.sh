#!/bin/sh
# Start Hono API in background
cd /app/api
DATA_DIR=/app/data DICT_DIR=${DICT_DIR:-/app/dict} PORT=${API_PORT:-3457} bun run src/index.ts &

# Inject the browser-facing API origin at runtime. NEXT_PUBLIC_* can't carry it
# (it bakes at build), so the client reads window.__ENV__.API_URL from this file
# instead — see src/lib/api-base.ts. Empty API_URL → the client falls back to
# http://localhost:3457 (only correct when browsing from this host).
cd /app
printf 'window.__ENV__ = { API_URL: "%s" };\n' "${API_URL:-}" > public/__env.js

# Start Next.js in foreground
node server.js
