#!/bin/bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
script="$root/scripts/ci/retag-tree-image.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
log="$tmp/docker.log"

write_docker() {
  local inspect_rc=$1
  cat >"$tmp/bin/docker" <<INNER
#!/bin/bash
echo "\$*" >>"$log"
if [ "\$1" = buildx ] && [ "\$2" = imagetools ] && [ "\$3" = inspect ]; then
  exit ${inspect_rc}
fi
if [ "\$1" = buildx ] && [ "\$2" = imagetools ] && [ "\$3" = create ]; then
  exit 0
fi
echo "unexpected docker: \$*" >&2
exit 1
INNER
  chmod +x "$tmp/bin/docker"
}

export PATH="$tmp/bin:$PATH"
export IMAGE_REPO="ghcr.io/heuwels/lector"
export IMAGE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export TREE_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export GITHUB_OUTPUT="$tmp/out"

rm -f "$log" "$GITHUB_OUTPUT"
write_docker 0
bash "$script" amd64
grep -q 'reused=true' "$GITHUB_OUTPUT"
grep -q "imagetools inspect ${IMAGE_REPO}:tree-${TREE_SHA}-amd64" "$log"
grep -q "imagetools create -t ${IMAGE_REPO}:sha-${IMAGE_SHA}-amd64 ${IMAGE_REPO}:tree-${TREE_SHA}-amd64" "$log"

rm -f "$log" "$GITHUB_OUTPUT"
write_docker 1
bash "$script" arm64
grep -q 'reused=false' "$GITHUB_OUTPUT"
grep -q "imagetools inspect ${IMAGE_REPO}:tree-${TREE_SHA}-arm64" "$log"
if grep -q "imagetools create" "$log"; then
  echo "create must not run when inspect misses" >&2
  exit 1
fi

if bash "$script" ppc64le >/dev/null 2>&1; then
  echo "unsupported arch must fail" >&2
  exit 1
fi

echo "retag-tree-image tests passed"
