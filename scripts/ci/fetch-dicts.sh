#!/bin/bash
# Restore or download every on-device dictionary pinned in dict.env.
# Files that already match the pinned SHA-256 are left in place so a
# GitHub Actions cache hit skips the network.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

set -a
# shellcheck disable=SC1091
. ./dict.env
set +a

mkdir -p data
for lang in $DICT_LANGS; do
  upper=$(echo "$lang" | tr '[:lower:]' '[:upper:]')
  ver_var="DICT_VERSION_$upper"
  sha_var="DICT_SHA256_$upper"
  ver="${!ver_var}"
  sha="${!sha_var}"
  dest="data/dictionary-${lang}.db"
  if [ -f "$dest" ] && echo "${sha}  ${dest}" | sha256sum -c -; then
    continue
  fi
  curl -fL --retry 3 \
    "https://github.com/heuwels/lector/releases/download/${ver}/dictionary-${lang}.db" \
    -o "$dest"
  echo "${sha}  ${dest}" | sha256sum -c -
done
