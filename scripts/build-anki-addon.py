#!/usr/bin/env python3
"""Package the Anki addon into dist/lector-anki-addon-<version>.ankiaddon.

The artifact is a zip of anki-addon/lector's CONTENTS (manifest.json at the
zip root — that's what Anki's Tools → Add-ons → Install from file expects).
The same zip is what AnkiWeb's upload form takes; AnkiWeb ignores the bundled
manifest and supplies its own metadata.

Version comes from ADDON_VERSION in anki-addon/lector/api.py (manifest.json's
human_version mirrors it; tests/test_api.py locks the pair together).

Usage: python3 scripts/build-anki-addon.py   (or: npm run build:anki-addon)
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "anki-addon" / "lector"
DIST = ROOT / "dist"

# meta.json is Anki's per-install state (config edits, disabled flag) — it
# must never ship; __pycache__ for the obvious reason.
EXCLUDE = {"meta.json", "__pycache__"}


def addon_version() -> str:
    source = (PACKAGE / "api.py").read_text(encoding="utf-8")
    match = re.search(r'^ADDON_VERSION = "([^"]+)"$', source, re.MULTILINE)
    if not match:
        sys.exit("ADDON_VERSION not found in anki-addon/lector/api.py")
    return match.group(1)


def main() -> None:
    version = addon_version()
    DIST.mkdir(exist_ok=True)
    target = DIST / f"lector-anki-addon-{version}.ankiaddon"

    files = sorted(
        path
        for path in PACKAGE.rglob("*")
        if path.is_file() and not (set(path.relative_to(PACKAGE).parts) & EXCLUDE)
    )

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(PACKAGE).as_posix())

    names = ", ".join(p.relative_to(PACKAGE).as_posix() for p in files)
    print(f"built {target.relative_to(ROOT)} ({len(files)} files: {names})")


if __name__ == "__main__":
    main()
