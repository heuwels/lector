#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang es`.

Writes scripts/coverage-corpus-es.txt: the top-N most frequent Spanish tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
Spanish reading" proxy. Spanish is supported by wordfreq natively (like German),
so this is the whole frequency story for Spanish.

    pip install wordfreq
    python scripts/gen-coverage-corpus-es.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-es.txt")

words = [w for w in wordfreq.top_n_list("es", N) if re.match(r"^[a-záéíóúüñ]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang es.\n")
    f.write(f"# Top-{N} wordfreq-es tokens, alpha-filtered to [a-záéíóúüñ]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-es.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
