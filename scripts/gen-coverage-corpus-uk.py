#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang uk`.

Writes scripts/coverage-corpus-uk.txt: the top-N most frequent Ukrainian tokens
(Cyrillic-filtered), used by the builder's >=85% coverage gate as the "typical
Ukrainian reading" proxy. Ukrainian is supported by wordfreq natively (like
Russian, Spanish and German), so this is the whole frequency story for Ukrainian.

The filter keeps the apostrophe, because it is a letter-level part of the
spelling (зв'язку, здоров'я, п'ять) and those words are frequent. wordfreq
writes it as ASCII ', which is also how kaikki writes the headwords — so the
corpus, the dictionary keys and the runtime fold all agree on one spelling.

    pip install wordfreq
    python scripts/gen-coverage-corpus-uk.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-uk.txt")

# The 33-letter Ukrainian alphabet: а-я is contiguous except ґ (U+0491),
# є (U+0454), і (U+0456) and ї (U+0457), which sit outside the range. ё, ы, ъ
# and э are Russian letters and are deliberately absent, so a Russian token
# that leaked into the frequency list is filtered out.
WORD = re.compile(r"^[а-щьюяґєіїʼ'-]+$")

words = [w for w in wordfreq.top_n_list("uk", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang uk.\n")
    f.write(
        f"# Top-{N} wordfreq-uk tokens, filtered to the Ukrainian alphabet "
        "(apostrophe and hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-uk.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
