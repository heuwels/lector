#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang nl`.

Writes scripts/coverage-corpus-nl.txt: the top-N most frequent Dutch tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
Dutch reading" proxy. Dutch is supported by wordfreq natively (like German,
Spanish and French), so this is the whole frequency story for Dutch. Apostrophe
plurals (foto's, taxi's) are split by wordfreq into bare stems, and the ij
digraph is plain i+j, so the alpha-filter needs no special cases.

    pip install wordfreq
    python scripts/gen-coverage-corpus-nl.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-nl.txt")

words = [w for w in wordfreq.top_n_list("nl", N) if re.match(r"^[a-zàáâäçèéêëìíîïòóôöùúûü]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang nl.\n")
    f.write(f"# Top-{N} wordfreq-nl tokens, alpha-filtered to [a-zàáâäçèéêëìíîïòóôöùúûü]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-nl.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
