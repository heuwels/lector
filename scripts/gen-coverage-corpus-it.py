#!/usr/bin/env python3
"""Generate the build-time coverage corpus for `build-dictionary.ts --lang it`.

Writes scripts/coverage-corpus-it.txt: the top-N most frequent Italian tokens
(alpha-filtered), used by the builder's >=85% coverage gate as the "typical
Italian reading" proxy. Italian is supported natively by wordfreq. Elisions
(l', un', dell'...) split into fragments; the alpha filter keeps both sides so
the measured corpus matches the runtime tokenizer.

    pip install wordfreq
    python scripts/gen-coverage-corpus-it.py [N]   # default N=5000
"""

import os
import re
import sys

import wordfreq

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
OUT = os.path.join(os.path.dirname(__file__), 'coverage-corpus-it.txt')
LETTER_PATTERN = r'^[a-zàèéìíîòóù]+$'

words = [word for word in wordfreq.top_n_list('it', N) if re.match(LETTER_PATTERN, word)]
with open(OUT, 'w') as output:
    output.write('# Build-time coverage corpus for build-dictionary.ts --lang it.\n')
    output.write(
        f'# Top-{N} wordfreq-it tokens, alpha-filtered to [a-zàèéìíîòóù]+. '
        "One per line; '#' = comment.\n"
    )
    output.write(f'# Regenerate: pip install wordfreq && python scripts/gen-coverage-corpus-it.py {N}\n')
    output.write('\n'.join(words) + '\n')

print(f'wrote {len(words)} words to {OUT}')
