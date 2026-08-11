#!/usr/bin/env python3
"""Generate curated roots for the grc dictionary build (rootsJsonRel).

Two jobs, one file (scripts/dictionary-roots-grc.json, consumed by
`build-dictionary.ts --lang grc` through the same mergeRanks mechanism as
Afrikaans):

1. **Frequency ranks** for every lemma of the Greek NT — lemma counts over
   MorphGNT/SBLGNT, densely ranked. Corpus frequency IS the curriculum for
   this audience (#254): "the ~300 lemmas occurring 50+ times cover ~80% of
   the running text".
2. **Fallback glosses** from the Dodson Greek-English lexicon (CC0, ~5,400 NT
   lemmas with brief definitions) for the Koine vocabulary kaikki's
   Classical-leaning Ancient Greek dump lacks entirely (καθώς, πάντοτε,
   ὡσαύτως…). Entries kaikki does carry keep their Wiktionary senses — the
   merge only adds a gloss when there is none.

Dodson headwords are Beta Code (a)ga/ph); a small converter renders polytonic
Unicode. Proper names (capitalized in Dodson, or absent there but capitalized
in MorphGNT) get partOfSpeech "name" so the cloze builder keeps excluding them.

    python scripts/gen-dictionary-roots-grc.py

Downloads are cached in tmp/ (MorphGNT shared with the other grc generators).
"""
import csv
import io
import json
import os
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "dictionary-roots-grc.json")
TMP = os.path.join(SCRIPT_DIR, "..", "tmp")
CACHE = os.path.join(TMP, "morphgnt")

MORPHGNT_RAW = "https://raw.githubusercontent.com/morphgnt/sblgnt/master"
DODSON_URL = "https://raw.githubusercontent.com/biblicalhumanities/Dodson-Greek-Lexicon/master/dodson.csv"
BOOK_FILES = [
    "61-Mt", "62-Mk", "63-Lk", "64-Jn", "65-Ac", "66-Ro", "67-1Co", "68-2Co",
    "69-Ga", "70-Eph", "71-Php", "72-Col", "73-1Th", "74-2Th", "75-1Ti",
    "76-2Ti", "77-Tit", "78-Phm", "79-Heb", "80-Jas", "81-1Pe", "82-2Pe",
    "83-1Jn", "84-2Jn", "85-3Jn", "86-Jud", "87-Re",
]

GREEK_WORD = re.compile(r"^[Ͱ-Ͽἀ-῿]+$")

BETA_LETTERS = {
    "a": "α", "b": "β", "g": "γ", "d": "δ", "e": "ε", "z": "ζ", "h": "η",
    "q": "θ", "i": "ι", "k": "κ", "l": "λ", "m": "μ", "n": "ν", "c": "ξ",
    "o": "ο", "p": "π", "r": "ρ", "s": "σ", "t": "τ", "u": "υ", "f": "φ",
    "x": "χ", "y": "ψ", "w": "ω", "v": "ϝ",
}
BETA_MARKS = {
    ")": "̓",  # smooth breathing
    "(": "̔",  # rough breathing
    "/": "́",  # acute
    "\\": "̀",  # grave
    "=": "͂",  # circumflex (perispomeni)
    "|": "ͅ",  # iota subscript
    "+": "̈",  # diaeresis
}

POS_LABELS = {
    "N-": "noun", "V-": "verb", "A-": "adj", "D-": "adv", "RA": "article",
    "RP": "pron", "RR": "pron", "RD": "pron", "RI": "pron", "C-": "conj",
    "P-": "prep", "X-": "particle", "I-": "intj",
}


def beta_to_unicode(beta: str) -> str:
    """Convert (lowercase-convention) Beta Code to polytonic Unicode, NFC."""
    out: list[str] = []
    upper = False
    pending_marks = ""
    for ch in beta:
        if ch == "*":
            upper = True
            continue
        if ch in BETA_MARKS:
            if upper:
                # Capitals write diacritics BEFORE the letter (*)abraa/m —
                # buffer them until the letter arrives.
                pending_marks += BETA_MARKS[ch]
            elif out:
                out.append(BETA_MARKS[ch])
            continue
        letter = BETA_LETTERS.get(ch.lower())
        if letter is None:
            continue  # digits, punctuation, spaces — not part of the word
        if upper:
            out.append(letter.upper())
            out.append(pending_marks)
            pending_marks = ""
            upper = False
        else:
            out.append(letter)
    word = unicodedata.normalize("NFC", "".join(out))
    # Word-final sigma.
    return re.sub(r"σ$", "ς", word)


def fetch(url: str, path: str) -> str:
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f"  downloading {url}")
        with urllib.request.urlopen(url) as response, open(path, "wb") as out:
            out.write(response.read())
    with open(path, encoding="utf-8") as f:
        return f.read()


def fold(word: str) -> str:
    return unicodedata.normalize("NFC", word).lower()


# 1. Lemma frequency + majority POS over MorphGNT.
lemma_counts: Counter[str] = Counter()
lemma_pos: dict[str, Counter[str]] = defaultdict(Counter)
lemma_capitalized: dict[str, bool] = {}
for book in BOOK_FILES:
    text = fetch(f"{MORPHGNT_RAW}/{book}-morphgnt.txt", os.path.join(CACHE, f"{book}-morphgnt.txt"))
    for line in text.splitlines():
        columns = line.split()
        if len(columns) != 7:
            continue
        raw_lemma = unicodedata.normalize("NFC", columns[6])
        lemma = fold(raw_lemma)
        if not GREEK_WORD.fullmatch(lemma):
            continue
        lemma_counts[lemma] += 1
        lemma_pos[lemma][columns[1]] += 1
        lemma_capitalized.setdefault(lemma, raw_lemma[:1].isupper())

# 2. Dodson glosses, keyed by folded polytonic lemma.
dodson_gloss: dict[str, str] = {}
dodson_capitalized: dict[str, bool] = {}
dodson_csv = fetch(DODSON_URL, os.path.join(TMP, "dodson.csv"))
for row in csv.DictReader(io.StringIO(dodson_csv), delimiter="\t"):
    headword_beta = (row.get("Greek Word") or "").split(",")[0].strip()
    if not headword_beta:
        continue
    word = beta_to_unicode(headword_beta)
    if not word:
        continue
    key = fold(word)
    brief = (row.get("English Definition (brief)") or "").strip()
    if brief and key not in dodson_gloss:
        dodson_gloss[key] = brief
        dodson_capitalized[key] = headword_beta.lstrip("(").startswith("*")

# 3. Emit ranked roots for every NT lemma.
roots: dict[str, dict[str, object]] = {}
for rank, (lemma, _count) in enumerate(lemma_counts.most_common(), start=1):
    pos_code = lemma_pos[lemma].most_common(1)[0][0]
    part_of_speech = POS_LABELS.get(pos_code, "")
    if part_of_speech == "noun" and (dodson_capitalized.get(lemma) or lemma_capitalized[lemma]):
        part_of_speech = "name"
    roots[lemma] = {
        "rank": rank,
        "translation": dodson_gloss.get(lemma, ""),
        "partOfSpeech": part_of_speech,
    }

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(roots, f, ensure_ascii=False, indent=1)
    f.write("\n")

glossed = sum(1 for r in roots.values() if r["translation"])
print(
    f"wrote {len(roots)} ranked NT lemmas to {OUT} "
    f"({glossed} with Dodson glosses, {len(dodson_gloss)} Dodson entries parsed)"
)
