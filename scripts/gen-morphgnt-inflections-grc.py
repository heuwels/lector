#!/usr/bin/env python3
"""Generate supplemental (inflected form → lemma) pairs for the grc dictionary.

kaikki Ancient Greek is form-of-rich for Classical paradigms but misses many
Koine surface forms (#254) — participles and late aorists the Wiktionary
tables don't enumerate. MorphGNT/SBLGNT carries a verified lemma for every
running word of the Greek NT; this script distills those into a TSV that
`build-dictionary.ts --lang grc` merges into the inflections table
(`supplementalInflectionsRel`). Rows whose lemma is not a dictionary entry are
dropped at build time, so the file can be regenerated independently.

Output columns (tab-separated): inflected_form, lemma, type. Both word columns
are NFC + lowercase, printed accentuation intact (graves included) — the same
folding the builder applies to kaikki keys.

    python scripts/gen-morphgnt-inflections-grc.py

MorphGNT downloads are cached in tmp/morphgnt/ (shared with
gen-coverage-corpus-grc.py).
"""
import os
import re
import unicodedata
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "morphgnt-inflections-grc.tsv")
CACHE = os.path.join(SCRIPT_DIR, "..", "tmp", "morphgnt")

MORPHGNT_RAW = "https://raw.githubusercontent.com/morphgnt/sblgnt/master"
BOOK_FILES = [
    "61-Mt", "62-Mk", "63-Lk", "64-Jn", "65-Ac", "66-Ro", "67-1Co", "68-2Co",
    "69-Ga", "70-Eph", "71-Php", "72-Col", "73-1Th", "74-2Th", "75-1Ti",
    "76-2Ti", "77-Tit", "78-Phm", "79-Heb", "80-Jas", "81-1Pe", "82-2Pe",
    "83-1Jn", "84-2Jn", "85-3Jn", "86-Jud", "87-Re",
]

GREEK_WORD = re.compile(r"^[Ͱ-Ͽἀ-῿]+$")

# MorphGNT part-of-speech → a short human label used in the "<type> form of"
# drawer line. Kept coarse: the parsing column is available but a full
# morphological gloss belongs to a later iteration.
POS_LABELS = {
    "N-": "noun",
    "V-": "verb",
    "A-": "adjective",
    "D-": "adverb",
    "RA": "article",
    "RP": "pronoun",
    "RR": "pronoun",
    "RD": "pronoun",
    "RI": "pronoun",
    "C-": "conjunction",
    "P-": "preposition",
    "X-": "particle",
    "I-": "interjection",
}


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


def fold(word: str) -> str:
    return unicodedata.normalize("NFC", word).lower()


pairs: dict[tuple[str, str], str] = {}
tokens = 0
for book in BOOK_FILES:
    for line in fetch(book).splitlines():
        columns = line.split()
        if len(columns) != 7:
            continue
        tokens += 1
        surface = fold(columns[4])  # punctuation-stripped, printed accents
        lemma = fold(columns[6])
        if surface == lemma:
            continue
        if not GREEK_WORD.fullmatch(surface) or not GREEK_WORD.fullmatch(lemma):
            continue
        label = POS_LABELS.get(columns[1], "")
        pairs.setdefault((surface, lemma), f"morphgnt{',' + label if label else ''}")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("# Supplemental grc inflections from MorphGNT/SBLGNT (CC BY-SA 3.0 analysis).\n")
    f.write("# inflected_form<TAB>lemma<TAB>type — merged by build-dictionary.ts --lang grc.\n")
    f.write(f"# Regenerate: python scripts/gen-morphgnt-inflections-grc.py\n")
    for (surface, lemma), label in sorted(pairs.items()):
        f.write(f"{surface}\t{lemma}\t{label}\n")
print(f"wrote {len(pairs)} (form, lemma) pairs from {tokens} running tokens to {OUT}")
