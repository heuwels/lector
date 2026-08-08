#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang cs`.

Writes scripts/coverage-corpus-cs.txt: the top-N most frequent Czech tokens,
used by the builder's >=85% coverage gate as the "typical Czech reading" proxy.
Czech is supported by wordfreq natively (like Polish, Russian and German), so
this is the whole frequency story for Czech.

The filter keeps only the Czech alphabet plus the hyphen. The apostrophe is
deliberately excluded: Czech writes it only for dialectal elision, never inside
a citation form, and the runtime tokenizer splits on it, so an apostrophe-
bearing token is never a dictionary key.

    pip install wordfreq
    python scripts/gen-coverage-corpus-cs.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-cs.txt")

# a-z plus the háček letters č ď ě ň ř š ť ž, the acute letters á é í ó ú ý, and
# ů. q, v, w and x are marginal in Czech but stay in the a-z range for the
# loanwords the dump carries.
WORD = re.compile(r"^[a-záčďéěíňóřšťúůýž-]+$")

words = [w for w in wordfreq.top_n_list("cs", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang cs.\n")
    f.write(
        f"# Top-{N} wordfreq-cs tokens, filtered to the Czech alphabet "
        "(hyphen kept, apostrophe excluded). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-cs.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
