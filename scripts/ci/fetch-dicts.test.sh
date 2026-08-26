#!/bin/bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
script="$root/scripts/ci/fetch-dicts.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sha256() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

body_af="af-body"
body_de="de-body"
sha_af=$(sha256 "$body_af")
sha_de=$(sha256 "$body_de")

mkdir -p "$tmp/bin" "$tmp/repo"
cat >"$tmp/repo/dict.env" <<EOF
DICT_LANGS="af de"
DICT_VERSION_AF=dict-af-test
DICT_SHA256_AF=$sha_af
DICT_VERSION_DE=dict-de-test
DICT_SHA256_DE=$sha_de
EOF

cat >"$tmp/bin/curl" <<'INNER'
#!/bin/bash
dest=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    dest=$2
    shift 2
    continue
  fi
  shift
done
case "$dest" in
  *dictionary-af.db) printf '%s' "af-body" >"$dest" ;;
  *dictionary-de.db) printf '%s' "de-body" >"$dest" ;;
  *)
    echo "unexpected dest: $dest" >&2
    exit 1
    ;;
esac
INNER
chmod +x "$tmp/bin/curl"

export PATH="$tmp/bin:$PATH"
export DICT_FETCH_ROOT="$tmp/repo"

DICT_FETCH_LANGS="af" bash "$script"
[ -f "$tmp/repo/data/dictionary-af.db" ]
if [ -f "$tmp/repo/data/dictionary-de.db" ]; then
  echo "subset fetch must not download de" >&2
  exit 1
fi

if DICT_FETCH_LANGS="zz" bash "$script" >/dev/null 2>&1; then
  echo "unknown language must fail" >&2
  exit 1
fi

unset DICT_FETCH_LANGS
bash "$script"
[ -f "$tmp/repo/data/dictionary-de.db" ]

echo "fetch-dicts tests passed"
