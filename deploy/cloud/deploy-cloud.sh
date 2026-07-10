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
DESIRED_IMAGE="ghcr.io/heuwels/lector:${LECTOR_IMAGE_TAG}"
PREVIOUS_IMAGE=$(awk '/^[[:space:]]+image: ghcr.io\/heuwels\/lector:/{print $2; exit}' "$COMPOSE")
if [ -z "$PREVIOUS_IMAGE" ]; then
  echo "could not find the lector image in $COMPOSE" >&2
  exit 2
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
set_image "$DESIRED_IMAGE"
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
