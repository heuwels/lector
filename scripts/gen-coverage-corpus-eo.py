#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang eo`.

Writes scripts/coverage-corpus-eo.txt: the top-N most frequent Esperanto
tokens (alpha-filtered, proper nouns dropped), used by the builder's >=85%
coverage gate as the "typical Esperanto reading" proxy.

Esperanto is NOT in wordfreq (unlike es/de/fr/it/nl/pt), so the source is the
custom blended frequency list — eo.wikipedia (written) + OPUS OpenSubtitles
(spoken) — built by woordeboek/process/eowiki-freq.py in the parent repo
(#307 §3.1, the same recipe Afrikaans uses). eo.wikipedia carries heavy
foreign-token contamination (URLs, reference titles, bot-stub infobox text:
"http", "the", "palomar"…), so each candidate must ALSO be attested in the
Tatoeba epo corpus (817k human-written Esperanto sentences, >= ATTEST
occurrences) — English junk is frequent in wiki text but absent from real
Esperanto sentences:

    tmp/wf-venv/bin/python woordeboek/process/eowiki-freq.py
    python scripts/gen-coverage-corpus-eo.py [N]   # default N=5000
"""
import csv
import os
import re
import sys
from collections import Counter

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
ATTEST = 3
FREQ_CSV = os.path.expanduser("~/personal/woordeboek/process/out/eo-wiki-freq.csv")
TATOEBA = os.path.join(os.path.dirname(__file__), "..", "tmp", "cloze-eo", "epo_sentences.tsv")
OUT = os.path.join(os.path.dirname(__file__), "coverage-corpus-eo.txt")

# The 28-letter alphabet, lowercased (q w x y are not Esperanto letters).
ALPHA_EO = re.compile(r"^[a-zĉĝĥĵŝŭ]+$")
TOKEN = re.compile(r"[a-zĉĝĥĵŝŭ]+")

attested = Counter()
with open(TATOEBA, encoding="utf-8") as fh:
    for line in fh:
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 3:
            for tok in TOKEN.findall(parts[2].lower()):
                attested[tok] += 1

words = []
with open(FREQ_CSV, encoding="utf-8", newline="") as fh:
    for row in csv.DictReader(fh):
        w = row["word"]
        # Blended rank order is the CSV order; keep clean, attested words only.
        if (
            len(w) >= 2
            and ALPHA_EO.match(w)
            and row["is_proper"] != "1"
            and attested[w] >= ATTEST
        ):
            words.append(w)
        if len(words) >= N:
            break

with open(OUT, "w", encoding="utf-8") as f:
    f.write("# Build-time coverage corpus for build-dictionary.ts --lang eo.\n")
    f.write(
        f"# Top-{N} tokens of the blended eo.wikipedia+OpenSubtitles frequency list\n"
        "# (eo has no wordfreq), alpha-filtered to the 28-letter alphabet, proper\n"
        f"# nouns dropped, and attested >= {ATTEST}× in Tatoeba epo (wiki foreign-token\n"
        "# contamination is absent from real Esperanto sentences). One per line.\n"
    )
    f.write(
        f"# Regenerate: tmp/wf-venv/bin/python woordeboek/process/eowiki-freq.py\n"
        f"#          && python scripts/gen-coverage-corpus-eo.py {N}\n"
    )
    f.write("\n".join(words) + "\n")
print(f"wrote {len(words)} words to {OUT}")
