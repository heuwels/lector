#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang pt`.

Writes scripts/coverage-corpus-pt.txt: the top-N most frequent Portuguese tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
Portuguese reading" proxy. Portuguese is supported by wordfreq natively (like
Spanish and German), so this is the whole frequency story for Portuguese. The
list is Brazilian-leaning (wordfreq pt is dominated by pt-BR sources), matching
the pack's pt-BR default.

    pip install wordfreq
    python scripts/gen-coverage-corpus-pt.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-pt.txt")

words = [w for w in wordfreq.top_n_list("pt", N) if re.match(r"^[a-zàáâãçéêíóôõúü]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang pt.\n")
    f.write(f"# Top-{N} wordfreq-pt tokens, alpha-filtered to [a-zàáâãçéêíóôõúü]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-pt.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
