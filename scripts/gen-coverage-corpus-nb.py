#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang nb`.

Writes scripts/coverage-corpus-nb.txt: the top-N most frequent Norwegian Bokmål
tokens, used by the builder's >=85% coverage gate.

    pip install wordfreq
    python scripts/gen-coverage-corpus-nb.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-nb.txt")

WORD = re.compile(r"^[a-zæøå-]+$")

words = [w for w in wordfreq.top_n_list("nb", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang nb.\n")
    f.write(
        f"# Top-{N} wordfreq-nb tokens, filtered to the Norwegian alphabet "
        "(hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-nb.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
