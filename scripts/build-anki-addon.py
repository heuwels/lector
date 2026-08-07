#!/usr/bin/env python3
"""Package the Anki addon into dist/lector-anki-addon-<version>.ankiaddon.

The artifact is a zip of anki-addon/lector's CONTENTS (manifest.json at the
zip root — that's what Anki's Tools → Add-ons → Install from file expects).
The same zip is what AnkiWeb's upload form takes; AnkiWeb ignores the bundled
manifest apart from its `conflicts` key, and supplies the rest of the metadata
itself.

Version comes from ADDON_VERSION in anki-addon/lector/api.py (manifest.json's
human_version mirrors it; tests/test_api.py locks the pair together).

Usage: python3 scripts/build-anki-addon.py             sideload artifact
       python3 scripts/build-anki-addon.py --ankiweb   AnkiWeb upload artifact
       (or: npm run build:anki-addon)
"""

from __future__ import annotations

import json
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

# An AnkiWeb install lands in a folder named by the numeric add-on id, so the
# AnkiWeb artifact can name the sideload folder as a conflict: Anki then
# disables a sideloaded copy on install instead of syncing the same queue twice.
# The sideload artifact must NOT carry this — _disableConflicting (aqt/addons.py)
# does not exclude the package it is installing, so a manifest that names its own
# folder disables itself on upgrade.
SIDELOAD_MODULE = "lector"


def addon_version() -> str:
    source = (PACKAGE / "api.py").read_text(encoding="utf-8")
    match = re.search(r'^ADDON_VERSION = "([^"]+)"$', source, re.MULTILINE)
    if not match:
        sys.exit("ADDON_VERSION not found in anki-addon/lector/api.py")
    return match.group(1)


def ankiweb_manifest() -> str:
    """The shipped manifest plus the conflicts key AnkiWeb acts on."""
    manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
    manifest["conflicts"] = [SIDELOAD_MODULE]
    return json.dumps(manifest, indent=2) + "\n"


def main() -> None:
    ankiweb = "--ankiweb" in sys.argv[1:]
    version = addon_version()
    DIST.mkdir(exist_ok=True)
    suffix = "-ankiweb" if ankiweb else ""
    target = DIST / f"lector-anki-addon-{version}{suffix}.ankiaddon"

    files = sorted(
        path
        for path in PACKAGE.rglob("*")
        if path.is_file() and not (set(path.relative_to(PACKAGE).parts) & EXCLUDE)
    )

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            name = path.relative_to(PACKAGE).as_posix()
            if ankiweb and name == "manifest.json":
                archive.writestr(name, ankiweb_manifest())
                continue
            archive.write(path, name)

    names = ", ".join(p.relative_to(PACKAGE).as_posix() for p in files)
    flavour = "AnkiWeb upload" if ankiweb else "sideload"
    print(f"built {target.relative_to(ROOT)} — {flavour} ({len(files)} files: {names})")


if __name__ == "__main__":
    main()
