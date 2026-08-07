#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang pl`.

Writes scripts/coverage-corpus-pl.txt: the top-N most frequent Polish tokens,
used by the builder's >=85% coverage gate as the "typical Polish reading" proxy.
Polish is supported by wordfreq natively (like Russian, Spanish and German), so
this is the whole frequency story for Polish.

The filter keeps only the 32-letter Polish alphabet plus the hyphen. The
apostrophe is deliberately excluded: in Polish it attaches a case ending to a
foreign stem (Kennedy'ego), which the runtime tokenizer splits, so an
apostrophe-bearing token is never a dictionary key.

    pip install wordfreq
    python scripts/gen-coverage-corpus-pl.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-pl.txt")

# a-z plus ą ć ę ł ń ó ś ź ż. q, v and x are not Polish letters but stay in the
# a-z range for the loanwords the dump carries.
WORD = re.compile(r"^[a-ząćęłńóśźż-]+$")

words = [w for w in wordfreq.top_n_list("pl", N) if WORD.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang pl.\n")
    f.write(
        f"# Top-{N} wordfreq-pl tokens, filtered to the Polish alphabet "
        "(hyphen kept, apostrophe excluded). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-pl.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
