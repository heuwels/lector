#!/usr/bin/env bash
set -euo pipefail

# ── Release script ──────────────────────────────────────────────────────────
# Runs the full test suite locally, then tags and pushes if everything passes.
# Usage: ./scripts/release.sh v1.10.1
# ────────────────────────────────────────────────────────────────────────────

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "  e.g. ./scripts/release.sh v1.10.1"
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must match vX.Y.Z (e.g. v1.10.1)"
  exit 1
fi

if git tag -l "$VERSION" | grep -q "$VERSION"; then
  echo "Error: tag $VERSION already exists"
  exit 1
fi

# Ensure we're on master and up to date
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "master" ]]; then
  echo "Error: must be on master (currently on $BRANCH)"
  exit 1
fi

echo "Pulling latest master..."
git pull --ff-only

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Release $VERSION — running checks"
echo "═══════════════════════════════════════════════════"
echo ""

# 1. Lint
echo "── Lint ──────────────────────────────────────────"
npm run lint
echo "✓ Lint passed"
echo ""

# 2. Typecheck
echo "── Typecheck ─────────────────────────────────────"
npx tsc --noEmit
echo "✓ Typecheck passed"
echo ""

# 3. Build
echo "── Build ─────────────────────────────────────────"
npm run build
echo "✓ Build passed"
echo ""

# 4. E2E tests
echo "── E2E Tests ─────────────────────────────────────"
npx playwright test
echo "✓ E2E tests passed"
echo ""

# All checks passed — create the tag
echo "═══════════════════════════════════════════════════"
echo "  All checks passed. Tagging $VERSION"
echo "═══════════════════════════════════════════════════"
echo ""

# Prompt for release notes
NOTES_FILE=$(mktemp)
echo "$VERSION" > "$NOTES_FILE"
echo "" >> "$NOTES_FILE"
echo "# Write release notes above. Lines starting with # are ignored." >> "$NOTES_FILE"
echo "# Save and close to continue, or empty the file to abort." >> "$NOTES_FILE"

${EDITOR:-vi} "$NOTES_FILE"

# Strip comments and check if empty
NOTES=$(grep -v '^#' "$NOTES_FILE" | sed '/^$/d')
rm -f "$NOTES_FILE"

if [[ -z "$NOTES" ]]; then
  echo "Aborted — empty release notes."
  exit 1
fi

git tag -a "$VERSION" -m "$NOTES"
git push origin "$VERSION"

echo ""
echo "✓ Tagged and pushed $VERSION"
echo "  → https://github.com/heuwels/lector/releases/tag/$VERSION"
