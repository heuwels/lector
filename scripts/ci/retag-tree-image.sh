#!/bin/bash
# Copy ghcr.io/heuwels/lector:tree-<tree>-<arch> to :sha-<commit>-<arch>
# when the pull-request job already pushed that tree. Exit 0 in both
# cases. Writes reused=true|false to GITHUB_OUTPUT when that file is set.
#
# Usage: retag-tree-image.sh <amd64|arm64>
set -euo pipefail

arch="${1:?arch required (amd64 or arm64)}"
case "$arch" in
  amd64 | arm64) ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 2
    ;;
esac

repo="${IMAGE_REPO:-ghcr.io/heuwels/lector}"
sha="${IMAGE_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
tree="${TREE_SHA:-$(git rev-parse 'HEAD^{tree}')}"
src="${repo}:tree-${tree}-${arch}"
dst="${repo}:sha-${sha}-${arch}"

inspect() {
  docker buildx imagetools inspect "$1"
}

create() {
  docker buildx imagetools create -t "$dst" "$src"
}

if inspect "$src" >/dev/null 2>&1; then
  create
  echo "Reused $src as $dst"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "reused=true" >>"$GITHUB_OUTPUT"
  fi
  exit 0
fi

echo "No CI image at $src"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "reused=false" >>"$GITHUB_OUTPUT"
fi
