#!/bin/bash
# Runs on a staging or production instance through SSM. CI supplies an immutable
# sha-<commit> tag and the expected deployment name. The same tag is first
# health-checked in staging, then promoted to production after environment
# approval. If health fails, restore the previous image automatically.
set -euo pipefail

: "${LECTOR_IMAGE_TAG:?LECTOR_IMAGE_TAG is required}"
: "${LECTOR_DEPLOYMENT:?LECTOR_DEPLOYMENT is required}"

if [[ ! "$LECTOR_IMAGE_TAG" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "invalid immutable image tag" >&2
  exit 2
fi
case "$LECTOR_DEPLOYMENT" in
  staging|production) ;;
  *) echo "invalid deployment name: $LECTOR_DEPLOYMENT" >&2; exit 2 ;;
esac

LECTOR_ROOT=${LECTOR_ROOT:-/srv/lector}
COMPOSE="$LECTOR_ROOT/docker-compose.yml"
REFRESH_ENV="$LECTOR_ROOT/refresh-env.sh"
DESIRED_IMAGE="ghcr.io/heuwels/lector:${LECTOR_IMAGE_TAG}"
PREVIOUS_IMAGE=$(awk '/^[[:space:]]+image: ghcr.io\/heuwels\/lector:/{print $2; exit}' "$COMPOSE")
if [ -z "$PREVIOUS_IMAGE" ]; then
  echo "could not find the lector image in $COMPOSE" >&2
  exit 2
fi

# The pre-gate production box still names its running image `latest`. Resolve
# that running container to its registry digest before pulling anything, so the
# first gated promotion has a real rollback target even after `latest` moves.
if [[ ! "$PREVIOUS_IMAGE" =~ ^ghcr\.io/heuwels/lector:(sha-[0-9a-f]{40})$ ]]; then
  RUNNING_IMAGE_ID=$(docker inspect --format '{{.Image}}' lector 2>/dev/null || true)
  PREVIOUS_DIGEST=$(docker image inspect "$RUNNING_IMAGE_ID" \
    --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null \
    | awk '/^ghcr\.io\/heuwels\/lector@sha256:[0-9a-f]{64}$/{print; exit}' || true)
  if [ -z "$PREVIOUS_DIGEST" ]; then
    echo "refusing deployment: mutable previous image has no immutable rollback digest" >&2
    exit 2
  fi
  PREVIOUS_IMAGE=$PREVIOUS_DIGEST
  echo "anchored first-promotion rollback to $PREVIOUS_IMAGE"
fi

set_image() {
  local image=$1
  local tmp
  tmp=$(mktemp "${COMPOSE}.XXXXXX")
  if ! awk -v image="$image" '
    /^[[:space:]]+image: ghcr\.io\/heuwels\/lector:/ && !changed {
      sub(/ghcr\.io\/heuwels\/lector:[^[:space:]]+/, image)
      changed = 1
    }
    { print }
    END { if (!changed) exit 1 }
  ' "$COMPOSE" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod --reference="$COMPOSE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$COMPOSE"
}

ensure_sentry_environment() {
  local environment=$1
  local tmp
  tmp=$(mktemp "${COMPOSE}.XXXXXX")
  if ! awk -v environment="$environment" '
    /^[[:space:]]+- SENTRY_ENVIRONMENT=/ {
      sub(/SENTRY_ENVIRONMENT=[^[:space:]]+/, "SENTRY_ENVIRONMENT=" environment)
      found = 1
    }
    { print }
    /^[[:space:]]+- LECTOR_MODE=cloud[[:space:]]*$/ && !found {
      match($0, /^[[:space:]]*/)
      print substr($0, RSTART, RLENGTH) "- SENTRY_ENVIRONMENT=" environment
      found = 1
    }
    END { if (!found) exit 1 }
  ' "$COMPOSE" > "$tmp"; then
    rm -f "$tmp"
    echo "could not set SENTRY_ENVIRONMENT in $COMPOSE" >&2
    return 1
  fi
  chmod --reference="$COMPOSE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$COMPOSE"
}

ensure_refresh_env_mapping() {
  local env_key=$1
  local parameter_suffix=$2
  local tmp
  tmp=$(mktemp "${REFRESH_ENV}.XXXXXX")
  if ! awk -v env_key="$env_key" -v parameter_suffix="$parameter_suffix" '
    $1 == "put" && $2 == env_key {
      if (!written) print "put " env_key " " parameter_suffix
      written = 1
      next
    }
    /^[[:space:]]*mv[[:space:]]+"\$TMP"[[:space:]]+"\$ENVFILE"[[:space:]]*$/ && !written {
      print "put " env_key " " parameter_suffix
      written = 1
    }
    { print }
    END { if (!written) exit 1 }
  ' "$REFRESH_ENV" > "$tmp"; then
    rm -f "$tmp"
    echo "could not add $env_key to $REFRESH_ENV" >&2
    return 1
  fi
  chmod --reference="$REFRESH_ENV" "$tmp" 2>/dev/null || chmod 700 "$tmp"
  mv "$tmp" "$REFRESH_ENV"
}

healthy() {
  for _ in $(seq 1 30); do
    if docker exec lector node -e 'fetch("http://localhost:3457/health").then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

echo "deploying $DESIRED_IMAGE to $LECTOR_DEPLOYMENT"
if ! ensure_sentry_environment "$LECTOR_DEPLOYMENT"; then
  exit 2
fi
# UserData is first-boot-only, so retained instances need new SSM mappings
# migrated before their on-box update helper refreshes the container env.
# Keep the Free flag last: refresh-env.sh writes one atomic file, but this
# ordering makes the dependency set explicit for humans reading deploy logs.
while read -r env_key parameter_suffix; do
  if ! ensure_refresh_env_mapping "$env_key" "$parameter_suffix"; then
    exit 2
  fi
done <<'MAPPINGS'
BYOK_ENCRYPTION_KEY byok-encryption-key
OPENAI_COMPAT_WORD_GLOSS_MODEL openai-compat-word-gloss-model
OPENAI_COMPAT_SIMPLE_PHRASE_MODEL openai-compat-simple-phrase-model
OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL openai-compat-simple-context-model
CLASSIFY_LLM_URL classify-llm-url
CLASSIFY_LLM_MODEL classify-llm-model
CLASSIFY_LLM_API_KEY openrouter-api-key
LECTOR_FREE_TIER free-tier-enabled
MAPPINGS
if ! set_image "$DESIRED_IMAGE"; then
  echo "could not pin $DESIRED_IMAGE in $COMPOSE" >&2
  exit 2
fi
if "$LECTOR_ROOT/update.sh" && healthy; then
  ACTUAL_IMAGE=$(docker inspect --format '{{.Config.Image}}' lector)
  if [ "$ACTUAL_IMAGE" != "$DESIRED_IMAGE" ]; then
    echo "healthy container uses $ACTUAL_IMAGE, expected $DESIRED_IMAGE" >&2
  else
    DIGEST=$(docker image inspect "$ACTUAL_IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "$ACTUAL_IMAGE (digest unknown)")
    echo "$LECTOR_DEPLOYMENT healthy: $DIGEST"
    exit 0
  fi
fi

echo "deployment failed; rolling back to $PREVIOUS_IMAGE" >&2
docker logs --tail 50 lector >&2 || true
set_image "$PREVIOUS_IMAGE"
if "$LECTOR_ROOT/update.sh" && healthy; then
  echo "rollback healthy: $PREVIOUS_IMAGE" >&2
else
  echo "CRITICAL: rollback to $PREVIOUS_IMAGE also failed" >&2
fi
exit 1
