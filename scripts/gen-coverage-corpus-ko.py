#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang ko`.

Writes scripts/coverage-corpus-ko.txt: the top-N most frequent Korean eojeol,
used by the builder's >=85% coverage gate as the "typical Korean reading" proxy.

This generator reads Tatoeba, not wordfreq, and it is the only one that does.
wordfreq has a Korean list, and its tokens are MORPHEMES. Its top 40 are 이, 는,
을, 하, 에, 다, 의, 고 — particles and bare verb stems. 하 is the stem of 하다 and
모르 is the stem of 모르다, and the dictionary keys the dictionary form, so a list
like that scores the dictionary against tokens no reader ever taps.

A Korean text is written in eojeol: a content word with its particles attached,
split by spaces. 집에 is one eojeol and holds 집 plus the locative 에. Whitespace
therefore gives the exact strings the runtime looks up, which is what the gate
has to measure. See `morphology` in languages/ko/manifest.ts for the peel
that turns an eojeol into a key.

Tatoeba writes its example sentences about a small cast of invented people, and
the Korean set spells each of them more than one way. No dictionary holds them,
so they would lower the score without saying anything about the build. A token
is dropped when it starts with one of the names AND the rest of it is two
syllables or fewer, which is the length of a particle. That keeps a real word
that merely starts the same way: 탐 is a placeholder, and 탐욕 is greed.

    python scripts/gen-coverage-corpus-ko.py [N]   # default N=5000
"""
import bz2
import os
import re
import sys
import urllib.request
from collections import Counter

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-ko.txt")
URL = "https://downloads.tatoeba.org/exports/per_language/kor/kor_sentences.tsv.bz2"

# Precomposed Hangul syllables. The jamo blocks stay out: a Korean text is
# written in syllables, and a lone jamo in the wild is a typo or an emoticon.
HANGUL = re.compile(r"^[가-힣]+$")
SPLIT = re.compile(r"[^가-힣]+")
# Tatoeba's placeholder names, in every spelling the Korean set uses.
NAMES = ("톰", "탐", "메리", "매리", "라일라", "야니")
# A particle is at most two syllables, so a longer tail means the token is a
# different word that happens to start with a name.
MAX_PARTICLE_SYLLABLES = 2


def is_placeholder_name(token: str) -> bool:
    for name in NAMES:
        if token.startswith(name) and len(token) - len(name) <= MAX_PARTICLE_SYLLABLES:
            return True
    return False


print(f"downloading {URL}")
with urllib.request.urlopen(URL) as response:
    raw = bz2.decompress(response.read()).decode("utf-8")

counts: Counter[str] = Counter()
sentences = 0
for line in raw.splitlines():
    parts = line.split("\t")
    if len(parts) < 3:
        continue
    sentences += 1
    for token in SPLIT.split(parts[2]):
        if token and HANGUL.match(token) and not is_placeholder_name(token):
            counts[token] += 1

words = [word for word, _ in counts.most_common(N)]
with open(OUT, "w") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang ko.\n")
    f.write(
        f"# Top-{N} eojeol by frequency in the {sentences} Tatoeba Korean sentences, "
        "with Tatoeba's placeholder names excluded. One per line; '#' = comment.\n"
    )
    f.write(f"# Regenerate: python scripts/gen-coverage-corpus-ko.py {N}\n")
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} eojeol to {OUT} ({len(counts)} distinct in {sentences} sentences)")
