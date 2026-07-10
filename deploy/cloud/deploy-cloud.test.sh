#!/bin/bash
set -euo pipefail

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin" "$ROOT/lector"

cat > "$ROOT/lector/docker-compose.yml" <<'EOF'
services:
  lector:
    image: ghcr.io/heuwels/lector:sha-1111111111111111111111111111111111111111
    environment:
      - LECTOR_MODE=cloud
EOF
cat > "$ROOT/lector/update.sh" <<'EOF'
#!/bin/bash
exit "${UPDATE_EXIT:-0}"
EOF
chmod +x "$ROOT/lector/update.sh"

cat > "$ROOT/bin/docker" <<'EOF'
#!/bin/bash
case "$1" in
  exec) exit "${HEALTH_EXIT:-0}" ;;
  inspect)
    if [ "$2" = "--format" ] && [ "$3" = "{{.Image}}" ]; then
      echo 'sha256:local-image-id'
    else
      awk '/^[[:space:]]+image: ghcr.io\/heuwels\/lector:/{print $2; exit}' "$LECTOR_ROOT/docker-compose.yml"
    fi
    ;;
  image)
    if [ "$2" = "inspect" ] && [ "$3" = "sha256:local-image-id" ]; then
      printf 'ghcr.io/heuwels/lector@sha256:%064d\n' 1
    else
      echo 'ghcr.io/heuwels/lector@sha256:test'
    fi
    ;;
  logs) exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$ROOT/bin/docker"

export PATH="$ROOT/bin:$PATH"
export LECTOR_ROOT="$ROOT/lector"
export LECTOR_DEPLOYMENT=staging
export LECTOR_IMAGE_TAG=sha-2222222222222222222222222222222222222222

bash deploy/cloud/deploy-cloud.sh >/dev/null
grep -q "image: ghcr.io/heuwels/lector:$LECTOR_IMAGE_TAG" "$ROOT/lector/docker-compose.yml"
grep -q -- '- SENTRY_ENVIRONMENT=staging' "$ROOT/lector/docker-compose.yml"

# A failed update restores the previously healthy image.
export LECTOR_IMAGE_TAG=sha-3333333333333333333333333333333333333333
export UPDATE_EXIT=1
if bash deploy/cloud/deploy-cloud.sh >/dev/null 2>&1; then
  echo 'expected failed deployment' >&2
  exit 1
fi
grep -q 'image: ghcr.io/heuwels/lector:sha-2222222222222222222222222222222222222222' "$ROOT/lector/docker-compose.yml"

# The first deploy from a mutable image rolls back by running-image digest.
sed -i.bak 's#image: ghcr.io/heuwels/lector:sha-[0-9a-f]*#image: ghcr.io/heuwels/lector:latest#' "$ROOT/lector/docker-compose.yml"
rm -f "$ROOT/lector/docker-compose.yml.bak"
export LECTOR_IMAGE_TAG=sha-4444444444444444444444444444444444444444
export UPDATE_EXIT=1
if bash deploy/cloud/deploy-cloud.sh >/dev/null 2>&1; then
  echo 'expected failed first deployment' >&2
  exit 1
fi
grep -q 'image: ghcr.io/heuwels/lector@sha256:0000000000000000000000000000000000000000000000000000000000000001' "$ROOT/lector/docker-compose.yml"

# Mutable or malformed tags are rejected before touching compose.
unset UPDATE_EXIT
export LECTOR_IMAGE_TAG=latest
if bash deploy/cloud/deploy-cloud.sh >/dev/null 2>&1; then
  echo 'expected mutable tag rejection' >&2
  exit 1
fi

echo 'deploy-cloud tests passed'
