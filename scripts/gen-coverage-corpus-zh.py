#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang zh`.

Writes scripts/coverage-corpus-zh.txt: the top-N most frequent Mandarin tokens,
used by the builder's >=85% coverage gate as the "typical Chinese reading" proxy.

wordfreq supports Chinese natively and segments it internally (it does not need
a space-delimited corpus), so this is the whole frequency story for zh. Its zh
list is SIMPLIFIED, which is what the build keys on. See `t2sMapRel` in the zh
profile. The gate therefore tests the keys the runtime will actually look up.

The filter keeps Han characters only. wordfreq's zh list carries a tail of Latin
tokens (brand names, loan abbreviations); they are not Chinese vocabulary, and
counting them would move the coverage number without saying anything about the
dictionary.

    pip install wordfreq
    python scripts/gen-coverage-corpus-zh.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-zh.txt")

# CJK Unified Ideographs + Extension A + the compatibility block, mirroring the
# zh profile's letterClass. Astral extensions are deliberately excluded there
# and here.
HAN = re.compile(r"^[㐀-䶿一-鿿豈-﫿]+$")

words = [w for w in wordfreq.top_n_list("zh", N) if HAN.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang zh.\n")
    f.write(
        f"# Top-{N} wordfreq-zh tokens, filtered to Han characters (Latin tokens "
        "excluded). Simplified, matching the build's t2sMapRel keying. One per line; "
        "'#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-zh.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
