#!/bin/sh
set -eu
# Deployment-mode guard (#242). `selfhost` (default) is the app as it has
# always been. `cloud` is fail-closed until accounts & auth ship (#218):
# booting today's fail-open API under a flag that promises tenant isolation
# would be worse than not booting. The one exception is the canary shape —
# LECTOR_CLOUD_GATE=external declares that an authenticating gateway (e.g.
# Cloudflare Access) fronts EVERY request, so auth is deliberately delegated
# (see deploy/cloud/). Unknown values refuse too — a typo must not silently
# run fail-open.
MODE="${LECTOR_MODE:-selfhost}"
GATE="${LECTOR_CLOUD_GATE:-}"
case "$MODE" in
  selfhost) ;;
  cloud)
    case "$GATE" in
      external) ;; # canary: an external gateway authenticates every request
      "")
        echo "FATAL: LECTOR_MODE=cloud is not available yet — cloud mode requires accounts & auth (heuwels/lector#218, tracked under #242). Unset LECTOR_MODE (or set it to selfhost) to run the self-hosted app. If an authenticating gateway (e.g. Cloudflare Access) fronts EVERY request, set LECTOR_CLOUD_GATE=external to run the cloud canary." >&2
        exit 1
        ;;
      *)
        echo "FATAL: invalid LECTOR_CLOUD_GATE \"$GATE\" — expected \"external\" (or unset)." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "FATAL: invalid LECTOR_MODE \"$MODE\" — expected \"selfhost\" or \"cloud\" (unset defaults to selfhost)." >&2
    exit 1
    ;;
esac

# Start Hono API in background
cd /app/api
DATA_DIR=/app/data DICT_DIR=${DICT_DIR:-/app/dict} PORT=3457 bun run src/index.ts &

# Inject runtime browser config. NEXT_PUBLIC_* can't carry these (it bakes at
# build), so the client reads window.__ENV__ from this file instead — see
# src/lib/api-base.ts. JSON-encoded via node so env values can never break out
# of the script context (SECURITY-06). Empty API_URL → the client falls back to
# http://localhost:3457 (only correct when browsing from this host).
cd /app
node -e 'require("fs").writeFileSync("public/__env.js", "window.__ENV__ = " + JSON.stringify({ API_URL: process.env.API_URL || "", LECTOR_MODE: process.env.LECTOR_MODE || "selfhost" }) + ";\n")'

# Start Next.js in foreground
node server.js
