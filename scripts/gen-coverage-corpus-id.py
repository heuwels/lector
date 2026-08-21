#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang id`.

Writes scripts/coverage-corpus-id.txt: the top-N most frequent Indonesian tokens,
used by the builder's >=85% coverage gate as the "typical Indonesian reading" proxy.
Indonesian is supported by wordfreq natively, so this is the whole frequency story.

The filter keeps only a-z plus the hyphen. Official spelling has no diacritics.
The hyphen stays so reduplicated plurals (buku-buku) remain whole keys.

    pip install wordfreq
    python scripts/gen-coverage-corpus-id.py [N]   # default N=5000
"""
import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-id.txt")

WORD = re.compile(r"^[a-z-]+$")
# wordfreq-id mixes English web text into the head of the list. Those tokens
# are not Indonesian dictionary keys and must not count against coverage.
ENGLISH = {
    "the", "of", "and", "to", "in", "a", "is", "it", "you", "that", "for",
    "on", "are", "as", "with", "his", "they", "be", "at", "one", "have",
    "this", "from", "or", "had", "by", "hot", "but", "some", "what", "there",
    "we", "can", "out", "other", "were", "all", "your", "when", "up", "use",
    "word", "how", "said", "an", "each", "she", "which", "do", "their",
    "time", "if", "will", "way", "about", "many", "then", "them", "would",
    "write", "like", "so", "these", "her", "long", "make", "thing", "see",
    "him", "two", "has", "look", "more", "day", "could", "go", "come", "did",
    "my", "no", "been", "who", "oil", "its", "now", "find", "than", "first",
    "water", "been", "call", "who", "may", "down", "side", "been", "now",
    "new", "me", "love", "http", "https", "www", "com", "website", "online",
    "john", "t", "la", "oh", "eh", "yeah",
}

words = [w for w in wordfreq.top_n_list("id", N) if WORD.match(w) and w not in ENGLISH]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang id.\n")
    f.write(
        f"# Top-{N} wordfreq-id tokens, filtered to plain Latin "
        "(hyphen kept). One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-id.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
