#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang hi`.

Writes scripts/coverage-corpus-hi.txt: the top-N most frequent Hindi tokens,
used by the builder's >=85% coverage gate as the "typical Hindi reading" proxy.
Hindi is supported by wordfreq natively.

The filter keeps Devanagari letters and marks. Digits and the danda stay out,
matching the runtime tokenizer. ZWJ and ZWNJ stay in for conjuncts.

    pip install wordfreq
    python scripts/gen-coverage-corpus-hi.py [N]   # default N=5000
"""
import os
import re
import sys
import unicodedata

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-hi.txt")

WORD = re.compile(r"^[\u0900-\u0963\u0971-\u097F\u200C\u200D]+$")


def keep(token: str) -> bool:
    folded = unicodedata.normalize("NFC", token)
    return bool(WORD.fullmatch(folded))


words = [unicodedata.normalize("NFC", w) for w in wordfreq.top_n_list("hi", N) if keep(w)]
# Dedup after NFC in case two spellings collapse.
seen: set[str] = set()
unique: list[str] = []
for word in words:
    if word in seen:
        continue
    seen.add(word)
    unique.append(word)

with open(OUT, "w", encoding="utf-8") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang hi.\n")
    f.write(
        f"# Top-{N} wordfreq-hi tokens, filtered to Devanagari "
        "(danda and digits excluded). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-hi.py {N}\n")
    f.write("\n".join(unique) + "\n")
print(f"wrote {len(unique)} words to {OUT}")
