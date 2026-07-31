#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang tr`.

Writes scripts/coverage-corpus-tr.txt: the top-N most frequent Turkish tokens,
used by the builder's >=85% coverage gate as the "typical Turkish reading"
proxy. Turkish is supported by wordfreq natively (like Spanish, German and
Russian), so this is the whole frequency story for Turkish.

Turkish is agglutinative, so a frequency list is mostly inflected surface forms
(evler, gidiyorum, arkadaşımla) rather than lemmas. That is the point: the gate
must measure what the runtime lookup really sees.

Case folding is locale-aware (`str.lower()` is not): Python lowercases I to i,
where Turkish needs ı. The builder folds keys the same way, so both sides agree.

    pip install wordfreq
    python scripts/gen-coverage-corpus-tr.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-tr.txt")

# The 29-letter alphabet in lower case. q/w/x are not Turkish letters and their
# loanword spellings are usually naturalized, so they stay out of the corpus.
TURKISH_WORD = re.compile(r"^[abcçdefgğhıijklmnoöprsştuüvyz]+$")

# Turkish case folding: I -> ı and İ -> i. str.lower() gets both wrong, so map
# the two dotted/dotless pairs first and lowercase the rest normally.
TURKISH_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def turkish_lower(word: str) -> str:
    return word.translate(TURKISH_LOWER).lower()


words = [w for w in (turkish_lower(w) for w in wordfreq.top_n_list("tr", N)) if TURKISH_WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang tr.\n")
    f.write(f"# Top-{N} wordfreq-tr tokens, Turkish-lowercased and filtered to the 29-letter alphabet.\n")
    f.write("# One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-tr.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
