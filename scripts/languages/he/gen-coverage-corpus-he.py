#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang he`.

Writes scripts/languages/he/coverage-corpus-he.txt: the top-N most frequent Hebrew tokens,
used by the builder's >=85% coverage gate. The list is folded the way
foldHebrewKey in languages/text.ts folds a key.

    tmp/starter-venv/bin/pip install wordfreq
    tmp/starter-venv/bin/python scripts/languages/he/gen-coverage-corpus-he.py [N]   # default N=5000
"""
import os
import re
import sys
import unicodedata

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-he.txt")

# Keep in step with foldHebrewKey in languages/text.ts.
HEBREW_MARKS = re.compile("[֑-ֽֿׁ-ׂׄ-ׇׅ]")
HEBREW_WORD = re.compile("^[א-ת][א-ת׳״]*$")


def fold(word: str) -> str:
    word = HEBREW_MARKS.sub("", unicodedata.normalize("NFC", word))
    word = re.sub("['‘’`´]", "׳", word)
    return re.sub('["“”]', "״", word)


def main() -> None:
    words: list[str] = []
    seen: set[str] = set()
    for raw in wordfreq.top_n_list("he", N * 3):
        word = fold(raw)
        # wordfreq splits a prefix off a digit (ב-2000 gives ב). The reader
        # never sees a lone prefix letter.
        if word in seen or len(word) < 2 or not HEBREW_WORD.match(word):
            continue
        seen.add(word)
        words.append(word)
        if len(words) == N:
            break
    with open(OUT, "w", encoding="utf-8") as out:
        out.write("\n".join(words) + "\n")
    print(f"wrote {len(words)} words to {OUT}")


if __name__ == "__main__":
    main()
