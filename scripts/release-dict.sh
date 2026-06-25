#!/usr/bin/env bash
#
# Build data/dictionary-<lang>.db from kaikki.org (+ curated roots for af), upload
# it as a GitHub Release asset, then pin it (DICT_VERSION_<LANG> + DICT_SHA256_<LANG>)
# in dict.env so subsequent docker builds and CI pull this exact file. Other
# languages' pins already in dict.env are preserved.
#
# Usage:
#   scripts/release-dict.sh                  # af (default), tag dict-af-YYYY-MM-DD
#   scripts/release-dict.sh de               # German, tag dict-de-YYYY-MM-DD
#   scripts/release-dict.sh de dict-de-v2    # explicit tag
#
# Requires: gh (authenticated to heuwels/lector), npx, sqlite3, sha256sum (or shasum).

set -euo pipefail

cd "$(dirname "$0")/.."

LANG_CODE="${1:-af}"
TAG="${2:-dict-${LANG_CODE}-$(date -u +%Y-%m-%d)}"
DB_PATH="data/dictionary-${LANG_CODE}.db"
LUP=$(printf '%s' "$LANG_CODE" | tr '[:lower:]' '[:upper:]')

echo ">> Building ${LANG_CODE} dictionary…"
# de's in-memory maps need a larger heap; harmless for af.
NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/build-dictionary.ts --lang "$LANG_CODE"

if [[ ! -f "$DB_PATH" ]]; then
  echo "!! Build did not produce $DB_PATH" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  SHA=$(sha256sum "$DB_PATH" | awk '{print $1}')
else
  SHA=$(shasum -a 256 "$DB_PATH" | awk '{print $1}')
fi

SIZE_MB=$(du -m "$DB_PATH" | awk '{print $1}')
ENTRIES=$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM entries;')
SENSES=$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM senses;')

ROOTS_NOTE=""
if [[ "$LANG_CODE" == "af" ]]; then
  ROOTS_NOTE=" + curated roots in \`src/lib/dictionary-roots.json\`"
fi

NOTES=$(cat <<EOF
On-device ${LANG_CODE} dictionary built from the kaikki.org Wiktionary dump${ROOTS_NOTE}.

- Entries: ${ENTRIES}
- Senses: ${SENSES}
- Size: ${SIZE_MB} MB
- SHA-256: \`${SHA}\`

Pulled into the Docker image at build time — pinned per language in \`dict.env\`.
EOF
)

echo ">> Creating GitHub release: $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo ">> Release $TAG already exists — uploading asset with --clobber"
  gh release upload "$TAG" "$DB_PATH" --clobber
else
  gh release create "$TAG" "$DB_PATH" \
    --title "Dictionary ${LANG_CODE} ${TAG}" \
    --notes "$NOTES" \
    --latest=false
fi

echo ">> Updating dict.env pin for ${LANG_CODE} (preserving other languages)"
if [[ -f dict.env ]]; then
  # shellcheck disable=SC1091
  . ./dict.env
fi
eval "DICT_VERSION_${LUP}=\$TAG"
eval "DICT_SHA256_${LUP}=\$SHA"

# Union of existing DICT_LANGS with this language (order-preserving, de-duped).
NEW_LANGS=""
for L in ${DICT_LANGS:-} "$LANG_CODE"; do
  case " $NEW_LANGS " in
    *" $L "*) ;;
    *) NEW_LANGS="${NEW_LANGS:+$NEW_LANGS }$L" ;;
  esac
done
DICT_LANGS="$NEW_LANGS"

{
  echo '# Pinned on-device dictionary releases — single source of truth.'
  echo '# Sourced by the Dockerfile (dict stage) and the CI workflows. Per language:'
  echo '#   DICT_VERSION_<LANG>  release tag holding dictionary-<lang>.db'
  echo '#   DICT_SHA256_<LANG>   sha256 of that asset'
  echo '# DICT_LANGS lists which languages are baked into the image / fetched by CI.'
  echo '# Regenerate a language with: scripts/release-dict.sh <lang>'
  echo "DICT_LANGS=\"${DICT_LANGS}\""
  for L in $DICT_LANGS; do
    U=$(printf '%s' "$L" | tr '[:lower:]' '[:upper:]')
    eval "v=\${DICT_VERSION_${U}:-}"
    eval "s=\${DICT_SHA256_${U}:-}"
    echo ""
    echo "# ${L}"
    echo "DICT_VERSION_${U}=${v}"
    echo "DICT_SHA256_${U}=${s}"
  done
} >dict.env

cat <<EOF

============================================================
Release published and dict.env updated for ${LANG_CODE}:

  DICT_VERSION_${LUP}=${TAG}
  DICT_SHA256_${LUP}=${SHA}
  DICT_LANGS="${DICT_LANGS}"

Commit dict.env to pin this dictionary into the image + CI, then open a PR.

Verify the download manually with:

  curl -fL "https://github.com/heuwels/lector/releases/download/${TAG}/dictionary-${LANG_CODE}.db" \\
    | sha256sum -c <(echo "${SHA}  -")
============================================================
EOF
