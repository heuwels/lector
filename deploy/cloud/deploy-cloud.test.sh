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
set -euo pipefail
"$LECTOR_ROOT/refresh-env.sh"
grep -q '^put BYOK_ENCRYPTION_KEY byok-encryption-key$' "$LECTOR_ROOT/refresh-env.sh"
[ "$(grep -c '^put BYOK_ENCRYPTION_KEY ' "$LECTOR_ROOT/refresh-env.sh")" -eq 1 ]
grep -q '^BYOK_ENCRYPTION_KEY=fixture-key$' "$LECTOR_ROOT/.env"
exit "${UPDATE_EXIT:-0}"
EOF
chmod +x "$ROOT/lector/update.sh"

# Existing instances retain this first-boot script across image deployments.
# This fixture intentionally predates the BYOK parameter mapping.
cat > "$ROOT/lector/refresh-env.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
ENVFILE="$LECTOR_ROOT/.env"
TMP=$(mktemp)
put() {
  if [ "$1" = "BYOK_ENCRYPTION_KEY" ] && [ "$2" = "byok-encryption-key" ]; then
    printf '%s=%s\n' "$1" fixture-key >> "$TMP"
  fi
}
put OPENAI_COMPAT_API_KEY openrouter-api-key
put GOOGLE_CLOUD_API_KEY google-api-key
mv "$TMP" "$ENVFILE"
EOF
chmod +x "$ROOT/lector/refresh-env.sh"

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
grep -q '^put BYOK_ENCRYPTION_KEY byok-encryption-key$' "$ROOT/lector/refresh-env.sh"
[ "$(grep -c '^put BYOK_ENCRYPTION_KEY ' "$ROOT/lector/refresh-env.sh")" -eq 1 ]
grep -q '^BYOK_ENCRYPTION_KEY=fixture-key$' "$ROOT/lector/.env"

# A failed update restores the previously healthy image.
export LECTOR_IMAGE_TAG=sha-3333333333333333333333333333333333333333
export UPDATE_EXIT=1
if bash deploy/cloud/deploy-cloud.sh >/dev/null 2>&1; then
  echo 'expected failed deployment' >&2
  exit 1
fi
grep -q 'image: ghcr.io/heuwels/lector:sha-2222222222222222222222222222222222222222' "$ROOT/lector/docker-compose.yml"
[ "$(grep -c '^put BYOK_ENCRYPTION_KEY ' "$ROOT/lector/refresh-env.sh")" -eq 1 ]

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
