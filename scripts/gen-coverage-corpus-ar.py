#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang ar`.

Writes scripts/coverage-corpus-ar.txt: the top-N most frequent Arabic tokens,
used by the builder's >=85% coverage gate as the "typical Arabic reading" proxy.
Arabic is supported by wordfreq natively (the `large_ar` list), so this is the
whole frequency story for Arabic.

The list is folded exactly as languages/text.ts foldArabicKey folds a key:
tashkeel and tatweel removed, and the alef spellings أ إ آ ٱ mapped to bare ا.
That fold is not cosmetic for Arabic. wordfreq's own top thirty holds both أن
and ان, which is one word under two spellings, and the dictionary keys only
the folded form. A corpus that skipped the fold would report misses the live
lookup does not have.

Arabic writes its conjunctions, short prepositions and definite article as
proclitics with no space, and its possessive pronouns as enclitics, so a
frequency list is full of forms like وبالمدرسة and كتابه that no dictionary
keys. That is the point: the gate must measure what the runtime lookup really
sees, and the pack's `morphology` slice is what has to answer them.

    tmp/starter-venv/bin/pip install wordfreq
    tmp/starter-venv/bin/python scripts/gen-coverage-corpus-ar.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-ar.txt")

# Arabic letters only. Digits (Arabic-Indic and ASCII), Latin letters and the
# Arabic punctuation ، ؛ ؟ are boundaries at runtime, so a token holding one is
# not a word the lookup will ever be asked for.
ARABIC_WORD = re.compile(r"^[ء-غف-ي]+$")

# Keep these three in step with foldArabicKey in languages/text.ts and with
# foldKey in scripts/build-dictionary.ts. All three must agree or a word keys
# under a spelling the corpus never asks about.
ARABIC_MARKS = re.compile("[ً-ٰٟۖ-ۭ]")
ARABIC_TATWEEL = "ـ"
ARABIC_ALEF_VARIANTS = re.compile("[آأإٱ]")


def fold_arabic(word: str) -> str:
    word = ARABIC_MARKS.sub("", word)
    word = word.replace(ARABIC_TATWEEL, "")
    return ARABIC_ALEF_VARIANTS.sub("ا", word)


seen: set[str] = set()
words: list[str] = []
for raw in wordfreq.top_n_list("ar", N):
    word = fold_arabic(raw)
    if not ARABIC_WORD.match(word) or word in seen:
        continue
    seen.add(word)
    words.append(word)

with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang ar.\n")
    f.write(f"# Top-{N} wordfreq-ar tokens, folded per foldArabicKey and filtered to Arabic letters.\n")
    f.write("# One per line; '#' = comment.\n")
    f.write(f"# Regenerate: tmp/starter-venv/bin/python scripts/gen-coverage-corpus-ar.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
