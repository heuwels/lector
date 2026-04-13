#!/bin/sh
# Start Hono API in background
cd /app/api
DATA_DIR=/app/data PORT=${API_PORT:-3457} bun run src/index.ts &

# Start Next.js in foreground
cd /app
node server.js
