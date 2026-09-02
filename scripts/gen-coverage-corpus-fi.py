#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang fi`.

Writes scripts/coverage-corpus-fi.txt: the top-N most frequent Finnish tokens,
used by the builder's >=85% coverage gate.

    pip install wordfreq
    python scripts/gen-coverage-corpus-fi.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-fi.txt")

WORD = re.compile(r"^[a-zäö-]+$")

words = [w for w in wordfreq.top_n_list("fi", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang fi.\n")
    f.write(
        f"# Top-{N} wordfreq-fi tokens, filtered to the Finnish alphabet "
        "(hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-fi.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
