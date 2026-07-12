#!/bin/sh
set -eu
# Deployment-mode guard (#242, re-purposed by #218). `selfhost` (default) is
# the app as it has always been. `cloud` proper runs built-in accounts &
# sessions (Better Auth) and must never sign them with the library's default
# dev secret — refuse to boot without BETTER_AUTH_SECRET. The canary shape is
# unchanged: LECTOR_CLOUD_GATE=external declares that an authenticating
# gateway (e.g. Cloudflare Access) fronts EVERY request, so auth is
# deliberately delegated (see deploy/cloud/). Unknown values refuse too — a
# typo must not silently run fail-open.
MODE="${LECTOR_MODE:-selfhost}"
GATE="${LECTOR_CLOUD_GATE:-}"
case "$MODE" in
  selfhost) ;;
  cloud)
    case "$GATE" in
      external) ;; # canary: an external gateway authenticates every request
      "")
        if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
          echo "FATAL: LECTOR_MODE=cloud requires BETTER_AUTH_SECRET — cloud mode runs built-in accounts & sessions (heuwels/lector#218) and must never sign them with a default secret. Generate one (e.g. \`openssl rand -base64 32\`) and set BETTER_AUTH_SECRET, or set LECTOR_CLOUD_GATE=external if an authenticating gateway fronts EVERY request. Unset LECTOR_MODE (or set it to selfhost) to run the self-hosted app." >&2
          exit 1
        fi
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

# Billing gate guard (#224), mirroring api/src/lib/billing.ts's boot assert:
# the API process backgrounds below, so without this check a misconfigured
# box would serve a live UI over a dead API. Armed billing needs cloud proper,
# a webhook secret, and the server API key used to create checkout transactions.
BILLING="${LECTOR_BILLING:-}"
case "$BILLING" in
  "") ;;
  paddle)
    if [ "$MODE" != "cloud" ] || [ -n "$GATE" ]; then
      echo "FATAL: LECTOR_BILLING=paddle requires cloud proper (LECTOR_MODE=cloud without LECTOR_CLOUD_GATE) — subscriptions attach to built-in accounts (heuwels/lector#224). Unset LECTOR_BILLING, or run cloud mode with built-in auth." >&2
      exit 1
    fi
    if [ -z "${PADDLE_WEBHOOK_SECRET:-}" ]; then
      echo "FATAL: LECTOR_BILLING=paddle requires PADDLE_WEBHOOK_SECRET — without Paddle webhooks no account can ever become paid, so enforcement would lock everyone out (heuwels/lector#224). Copy the notification destination's secret key from Paddle → Developer tools → Notifications." >&2
      exit 1
    fi
    if [ -z "${PADDLE_API_KEY:-}" ]; then
      echo "FATAL: LECTOR_BILLING=paddle requires PADDLE_API_KEY — without it no account can create a checkout transaction." >&2
      exit 1
    fi
    ;;
  *)
    echo "FATAL: invalid LECTOR_BILLING \"$BILLING\" — expected \"paddle\" (or unset for no billing)." >&2
    exit 1
    ;;
esac

# Derived Free access is a separate, strict rollout boundary. It only makes
# sense alongside Paddle + built-in accounts. Production public signup must
# have both Turnstile halves configured; NODE_ENV=test intentionally skips
# this network-backed prerequisite for isolated browser tests.
FREE_TIER="${LECTOR_FREE_TIER:-}"
case "$FREE_TIER" in
  ""|false) ;;
  true)
    if [ "$BILLING" != "paddle" ] || [ "$MODE" != "cloud" ] || [ -n "$GATE" ]; then
      echo "FATAL: LECTOR_FREE_TIER=true requires LECTOR_BILLING=paddle and cloud proper (LECTOR_MODE=cloud without LECTOR_CLOUD_GATE)." >&2
      exit 1
    fi
    if [ "${NODE_ENV:-production}" = "production" ]; then
      if [ -z "${TURNSTILE_SECRET_KEY:-}" ] || [ -z "${TURNSTILE_SITE_KEY:-}" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY so public no-card signup cannot run without bot protection." >&2
        exit 1
      fi
      if [ -z "${PADDLE_PRICE_MONTHLY:-}" ] && [ -z "${PADDLE_PRICE_ANNUAL:-}" ] && [ -z "${PADDLE_PRICE_PLUS_MONTHLY:-}" ] && [ -z "${PADDLE_PRICE_PLUS_ANNUAL:-}" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires at least one PADDLE_PRICE_* so the advertised Cloud upsell can start checkout." >&2
        exit 1
      fi
      if [ -z "${GOOGLE_CLOUD_API_KEY:-}" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires GOOGLE_CLOUD_API_KEY so the advertised paid managed-voice upsell is available." >&2
        exit 1
      fi
      if ! node -e 'const raw = process.env.BYOK_ENCRYPTION_KEY || ""; let key; try { key = Buffer.from(raw.trim(), "base64"); } catch { process.exit(1); } if (key.length !== 32) process.exit(1);'; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires BYOK_ENCRYPTION_KEY to be a valid base64-encoded 32-byte key so Free accounts can use BYOK." >&2
        exit 1
      fi
      if [ "${CLASSIFY_WORKER:-}" = "1" ] && { [ -z "${CLASSIFY_LLM_URL:-}" ] || [ -z "${CLASSIFY_LLM_MODEL:-}" ]; }; then
        echo "FATAL: LECTOR_FREE_TIER=true with CLASSIFY_WORKER=1 requires dedicated CLASSIFY_LLM_URL and CLASSIFY_LLM_MODEL values so Free vocabulary cannot fall back to the unmetered managed translation provider." >&2
        exit 1
      fi
      OPENROUTER_URL="${OPENAI_COMPAT_URL:-}"
      OPENROUTER_URL="${OPENROUTER_URL%/}"
      if [ "${LLM_PROVIDER:-}" != "openai" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires LLM_PROVIDER=openai." >&2
        exit 1
      fi
      if [ "$OPENROUTER_URL" != "https://openrouter.ai/api" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_URL=https://openrouter.ai/api." >&2
        exit 1
      fi
      if [ -z "${OPENAI_COMPAT_API_KEY:-}" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_API_KEY for managed translations." >&2
        exit 1
      fi
      MANAGED_TRANSLATION_MODEL="google/gemini-2.5-flash-lite"
      if [ "${OPENAI_COMPAT_WORD_GLOSS_MODEL:-}" != "$MANAGED_TRANSLATION_MODEL" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_WORD_GLOSS_MODEL=$MANAGED_TRANSLATION_MODEL." >&2
        exit 1
      fi
      if [ "${OPENAI_COMPAT_SIMPLE_PHRASE_MODEL:-}" != "$MANAGED_TRANSLATION_MODEL" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_SIMPLE_PHRASE_MODEL=$MANAGED_TRANSLATION_MODEL." >&2
        exit 1
      fi
      if [ "${OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL:-}" != "$MANAGED_TRANSLATION_MODEL" ]; then
        echo "FATAL: LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL=$MANAGED_TRANSLATION_MODEL." >&2
        exit 1
      fi
    fi
    ;;
  *)
    echo "FATAL: invalid LECTOR_FREE_TIER \"$FREE_TIER\" — expected \"true\", \"false\", or unset." >&2
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
node -e 'require("fs").writeFileSync("public/__env.js", "window.__ENV__ = " + JSON.stringify({ API_URL: process.env.API_URL || "", SENTRY_DSN: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "", SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || "", LECTOR_MODE: process.env.LECTOR_MODE || "selfhost", CHECKOUT_URL: process.env.CHECKOUT_URL || "", TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || "", GITHUB_LOGIN: process.env.GITHUB_CLIENT_ID ? "1" : "", OIDC_LOGIN: process.env.OIDC_CLIENT_ID ? "1" : "", OIDC_PROVIDER_NAME: process.env.OIDC_PROVIDER_NAME || "" }) + ";\n")'

# Start Next.js in foreground
node server.js
