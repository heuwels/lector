#!/bin/bash
# Restore or download on-device dictionaries pinned in dict.env.
# DICT_FETCH_LANGS limits the run to a subset. Empty means every DICT_LANGS pin.
# Files that already match the pinned SHA-256 are left in place so a
# GitHub Actions cache hit skips the network.
set -euo pipefail

root=${DICT_FETCH_ROOT:-$(git rev-parse --show-toplevel)}
cd "$root"

set -a
# shellcheck disable=SC1091
. ./dict.env
set +a

if [ -n "${DICT_FETCH_LANGS:-}" ]; then
  langs=$DICT_FETCH_LANGS
else
  langs=$DICT_LANGS
fi

mkdir -p data
for lang in $langs; do
  case " $DICT_LANGS " in
    *" $lang "*) ;;
    *)
      echo "Unknown dictionary language: $lang" >&2
      exit 1
      ;;
  esac
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
