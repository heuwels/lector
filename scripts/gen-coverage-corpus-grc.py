#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang grc`.

Koine Greek has no wordfreq support (#254) — frequency comes from the target
corpus itself: the Greek New Testament via MorphGNT/SBLGNT (per-word lemma +
morphology, CC BY-SA 3.0 analysis over the SBLGNT text). Writes
scripts/coverage-corpus-grc.txt: the top-N most frequent SURFACE forms as
printed in running text (accentuation intact, including the grave that
replaces a word-final acute mid-sentence) — exactly what readers tap, so the
builder's >=85% coverage gate measures the accent-insensitive fallback too.

    python scripts/gen-coverage-corpus-grc.py [N]   # default N=5000

MorphGNT downloads are cached in tmp/morphgnt/.
"""
import os
import re
import sys
import unicodedata
import urllib.request
from collections import Counter

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "coverage-corpus-grc.txt")
CACHE = os.path.join(SCRIPT_DIR, "..", "tmp", "morphgnt")

MORPHGNT_RAW = "https://raw.githubusercontent.com/morphgnt/sblgnt/master"
BOOK_FILES = [
    "61-Mt", "62-Mk", "63-Lk", "64-Jn", "65-Ac", "66-Ro", "67-1Co", "68-2Co",
    "69-Ga", "70-Eph", "71-Php", "72-Col", "73-1Th", "74-2Th", "75-1Ti",
    "76-2Ti", "77-Tit", "78-Phm", "79-Heb", "80-Jas", "81-1Pe", "82-2Pe",
    "83-1Jn", "84-2Jn", "85-3Jn", "86-Jud", "87-Re",
]

GREEK_WORD = re.compile(r"^[Ͱ-Ͽἀ-῿]+$")


def fetch(book: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{book}-morphgnt.txt")
    if not os.path.exists(path):
        url = f"{MORPHGNT_RAW}/{book}-morphgnt.txt"
        print(f"  downloading {url}")
        with urllib.request.urlopen(url) as response, open(path, "wb") as out:
            out.write(response.read())
    with open(path, encoding="utf-8") as f:
        return f.read()


counts: Counter[str] = Counter()
for book in BOOK_FILES:
    for line in fetch(book).splitlines():
        columns = line.split()
        if len(columns) != 7:
            continue
        # Column 5 is the surface word with punctuation stripped but printed
        # accentuation kept (graves included) — the reader-tap view of the text.
        word = unicodedata.normalize("NFC", columns[4]).lower()
        if GREEK_WORD.fullmatch(word):
            counts[word] += 1

words = [w for w, _ in counts.most_common(N)]
with open(OUT, "w", encoding="utf-8") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang grc.\n")
    f.write(
        f"# Top-{N} surface forms of the Greek NT (MorphGNT/SBLGNT), printed accentuation\n"
    )
    f.write("# intact. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: python scripts/gen-coverage-corpus-grc.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT} ({sum(counts.values())} running tokens, {len(counts)} distinct)")
