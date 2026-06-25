#!/bin/bash
set -e

# Configuration
# NOTE: this publishes to ghcr.io/3stacks, whereas the CI workflows
# (.github/workflows/docker.yml + release.yml) publish to ghcr.io/heuwels — the
# production registry (it matches the git remote and the Dockerfile dict URL).
# This script looks personal/stale; prefer the CI pipeline for real releases.
REGISTRY="ghcr.io/3stacks"
IMAGE_NAME="lector"
VERSION="${1:-$(git describe --tags --always --dirty)}"

# Full image name
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${VERSION}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

echo "Building ${FULL_IMAGE}..."
# Stamp version metadata into the image (the build context has no .git — see
# .dockerignore). BUILD_TIME is stamped by next.config during `npm run build`.
docker build \
  --build-arg APP_VERSION="${VERSION}" \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)" \
  --build-arg GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)" \
  -t "${FULL_IMAGE}" -t "${LATEST_IMAGE}" .

echo "Pushing to registry..."
docker push "${FULL_IMAGE}"
docker push "${LATEST_IMAGE}"

echo ""
echo "Done! Image pushed:"
echo "  ${FULL_IMAGE}"
echo "  ${LATEST_IMAGE}"
echo ""
echo "On your server, update docker-compose.yml to use:"
echo "  image: ${FULL_IMAGE}"
echo ""
echo "Then run: docker compose pull && docker compose up -d"
