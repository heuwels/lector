#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang de`.

Writes scripts/coverage-corpus-de.txt: the top-N most frequent German tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
German reading" proxy. German is supported by wordfreq natively (unlike
Afrikaans, which needed a custom Wikipedia+subtitles frequency build), so this
is the whole frequency story for German.

    pip install wordfreq
    python scripts/gen-coverage-corpus-de.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-de.txt")

words = [w for w in wordfreq.top_n_list("de", N) if re.match(r"^[a-zäöüß]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang de.\n")
    f.write(f"# Top-{N} wordfreq-de tokens, alpha-filtered to [a-zäöüß]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-de.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
