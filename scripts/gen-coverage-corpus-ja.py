#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang ja`.

Writes scripts/coverage-corpus-ja.txt: the top-N most frequent Japanese tokens,
used by the builder's coverage gate as the "typical Japanese reading" proxy.

wordfreq supports Japanese natively and segments it internally, so this is the
whole frequency story for ja.

The filter keeps kana AND kanji, which is the one real difference from the zh
generator. A Han-only filter would discard する, こと, ある, です and ます, and
those sit at the very head of the Japanese frequency list. Latin tokens are
excluded: the list carries a tail of brand names and loan abbreviations, and
counting them would move the coverage number without saying anything about the
dictionary.

    pip install wordfreq
    python scripts/gen-coverage-corpus-ja.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-ja.txt")

# Hiragana, katakana with the prolonged sound mark, the iteration mark, and the
# Han ranges — mirroring the ja profile's letterClass.
JA = re.compile(r"^[ぁ-ゟ゠-ヿー々㐀-䶿一-鿿豈-﫿]+$")

words = [w for w in wordfreq.top_n_list("ja", N) if JA.match(w)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang ja.\n")
    f.write(
        f"# Top-{N} wordfreq-ja tokens, filtered to kana and kanji (Latin tokens "
        "excluded). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-ja.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
