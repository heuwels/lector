#!/usr/bin/env bash
#
# Build data/dictionary-af.db from kaikki.org + the curated roots, then upload
# it as a GitHub Release asset. Prints the values to paste into the Dockerfile
# (DICT_VERSION + DICT_SHA256) so subsequent docker builds pull this exact file.
#
# Usage:
#   scripts/release-dict.sh            # auto-generate tag (dict-YYYY-MM-DD)
#   scripts/release-dict.sh dict-v2    # explicit tag
#
# Requires: gh (authenticated to heuwels/lector), npx, sha256sum (or shasum).

set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${1:-dict-$(date -u +%Y-%m-%d)}"
DB_PATH="data/dictionary-af.db"

echo ">> Building dictionary…"
npx tsx scripts/build-dictionary.ts

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

NOTES=$(cat <<EOF
Built from kaikki.org Afrikaans Wiktionary dump + curated roots in \`src/lib/dictionary-roots.json\`.

- Entries: ${ENTRIES}
- Senses: ${SENSES}
- Size: ${SIZE_MB} MB
- SHA-256: \`${SHA}\`

Pulled into the Docker image at build time — see Dockerfile \`DICT_VERSION\` ARG.
EOF
)

echo ">> Creating GitHub release: $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo ">> Release $TAG already exists — uploading asset with --clobber"
  gh release upload "$TAG" "$DB_PATH" --clobber
else
  gh release create "$TAG" "$DB_PATH" \
    --title "Dictionary $TAG" \
    --notes "$NOTES" \
    --latest=false
fi

cat <<EOF

============================================================
Release published.

To pin this build into the Docker image, update Dockerfile:

  ARG DICT_VERSION=${TAG}
  ARG DICT_SHA256=${SHA}

Verify the download manually with:

  curl -fL "https://github.com/heuwels/lector/releases/download/${TAG}/dictionary-af.db" \\
    | sha256sum -c <(echo "${SHA}  -")
============================================================
EOF
