#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang el`.

Writes scripts/coverage-corpus-el.txt: the top-N most frequent Modern Greek
tokens, used by the builder's >=85% coverage gate.

    pip install wordfreq
    python scripts/gen-coverage-corpus-el.py [N]   # default N=5000
"""
import os
import re
import sys
import unicodedata

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-el.txt")

WORD = re.compile(r"^[\u0370-\u03ff-]+$")


def keep(token: str) -> bool:
    folded = unicodedata.normalize("NFC", token.casefold())
    return bool(WORD.fullmatch(folded))


words = [unicodedata.normalize("NFC", w) for w in wordfreq.top_n_list("el", N) if keep(w)]
seen: set[str] = set()
unique: list[str] = []
for word in words:
    if word in seen:
        continue
    seen.add(word)
    unique.append(word)

with open(OUT, "w", encoding="utf-8") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang el.\n")
    f.write(
        f"# Top-{N} wordfreq-el tokens, filtered to the Greek block "
        "(hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-el.py {N}\n")
    f.write("\n".join(unique) + "\n")
print(f"wrote {len(unique)} words to {OUT}")
