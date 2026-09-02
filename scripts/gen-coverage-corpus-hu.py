#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang hu`.

Writes scripts/coverage-corpus-hu.txt: the top-N most frequent Hungarian tokens,
used by the builder's >=85% coverage gate.

    pip install wordfreq
    python scripts/gen-coverage-corpus-hu.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-hu.txt")

WORD = re.compile(r"^[a-záéíóöőúüű-]+$")

words = [w for w in wordfreq.top_n_list("hu", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang hu.\n")
    f.write(
        f"# Top-{N} wordfreq-hu tokens, filtered to the Hungarian alphabet "
        "(hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-hu.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
