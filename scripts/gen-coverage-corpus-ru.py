#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang ru`.

Writes scripts/coverage-corpus-ru.txt: the top-N most frequent Russian tokens
(Cyrillic-filtered), used by the builder's >=85% coverage gate as the "typical
Russian reading" proxy. Russian is supported by wordfreq natively (like Spanish
and German), so this is the whole frequency story for Russian. wordfreq data is
unstressed and mixes е/ё spellings, matching real text — the builder's
ё-aliases exist for exactly that.

    pip install wordfreq
    python scripts/gen-coverage-corpus-ru.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-ru.txt")

words = [w for w in wordfreq.top_n_list("ru", N) if re.match(r"^[а-яё]+$", w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang ru.\n")
    f.write(f"# Top-{N} wordfreq-ru tokens, filtered to Cyrillic [а-яё]+. One per line; '#' = comment.\n")
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-ru.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
