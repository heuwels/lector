#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang bn`.

Writes scripts/coverage-corpus-bn.txt: the top-N most frequent Bengali tokens,
used by the builder's coverage gate as the "typical Bengali reading" proxy.
Bengali is supported by wordfreq natively (the `large_bn` list), so this is the
whole frequency story for Bengali.

Read the `coverageThreshold` note on the `bn` profile before you use the number
this corpus produces. bn builds against a 65% gate rather than the usual 85%,
because English Wiktionary holds 9,929 glossed Bengali headwords and the tail of
this list is the Sanskrit-derived register a newspaper is written in.

The list needs no fold. Bengali has no letter case, and the bn pack declares no
key fold, so `foldWord` is NFC alone and a printed token is already its key.
NFC still matters: the Bengali vowel signs ো and ৌ and the letters ড় ঢ় য় all
have canonical decompositions, and a decomposed token would never match a
composed key.

Bengali writes its case, its plural and its classifiers as suffixes with no
space, so this list is full of forms like সালের and বইগুলোর that no dictionary
keys. That is the point: the gate must measure what the runtime lookup really
sees, and the pack's `morphology` slice is what has to answer them.

    tmp/starter-venv/bin/pip install wordfreq
    tmp/starter-venv/bin/python scripts/gen-coverage-corpus-bn.py [N]   # default N=5000
"""
import os
import re
import sys
import unicodedata

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-bn.txt")

# The Bengali block only. Latin letters, ASCII digits and the Bengali digits
# ০-৯ are boundaries at runtime, so a token holding one is not a word the
# lookup will ever be asked for. Keep this in step with `letterClass` on the bn
# profile in scripts/build-dictionary.ts, minus the digits.
BENGALI_WORD = re.compile(r"^[ঀ-৾]+$")
BENGALI_DIGITS = re.compile(r"[০-৯]")

seen: set[str] = set()
words: list[str] = []
for raw in wordfreq.top_n_list("bn", N):
    word = unicodedata.normalize("NFC", raw)
    if not BENGALI_WORD.match(word) or BENGALI_DIGITS.search(word) or word in seen:
        continue
    seen.add(word)
    words.append(word)

with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang bn.\n")
    f.write(f"# Top-{N} wordfreq-bn tokens, NFC-normalized and filtered to Bengali letters.\n")
    f.write("# One per line; '#' = comment.\n")
    f.write(f"# Regenerate: tmp/starter-venv/bin/python scripts/gen-coverage-corpus-bn.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
