#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang fr`.

Writes scripts/coverage-corpus-fr.txt: the top-N most frequent French tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
French reading" proxy. French is supported by wordfreq natively (like German and
Spanish), so this is the whole frequency story for French. Elision fragments
(l', d', qu'…) are already split by wordfreq into bare letters, which the
alpha-filter's length>=1 keeps out of the way of real content words.

    pip install wordfreq
    python scripts/gen-coverage-corpus-fr.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-fr.txt")

words = [w for w in wordfreq.top_n_list("fr", N) if re.match(r"^[a-zàâæçèéêëîïôûùüÿœ]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang fr.\n")
    f.write(f"# Top-{N} wordfreq-fr tokens, alpha-filtered to [a-zàâæçèéêëîïôûùüÿœ]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-fr.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
