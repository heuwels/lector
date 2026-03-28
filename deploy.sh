#!/bin/bash
set -e

# Configuration
REGISTRY="ghcr.io/3stacks"
IMAGE_NAME="afrikaans-reader"
VERSION="${1:-$(git describe --tags --always --dirty)}"

# Full image name
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${VERSION}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

echo "Building ${FULL_IMAGE}..."
docker build -t "${FULL_IMAGE}" -t "${LATEST_IMAGE}" .

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
