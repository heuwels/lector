#!/usr/bin/env python3
"""Generate the Latin coverage corpus and the DCC rank spine (#256).

Writes:
  scripts/dcc-latin-core.tsv     folded lemma + DCC frequency rank
  scripts/coverage-corpus-la.txt DCC lemmas (macron-stripped), one per line

The DCC Latin Core Vocabulary is CC BY-SA 3.0 (Dickinson College).

    python scripts/gen-coverage-corpus-la.py
"""

from __future__ import annotations

import csv
import sys
import unicodedata
import urllib.error
import urllib.request
from io import StringIO
from pathlib import Path

PROJECT = Path(__file__).resolve().parent
DCC_CSV = 'https://dcc.dickinson.edu/latin-core-list.csv?page&_format=csv'
TSV_OUT = PROJECT / 'dcc-latin-core.tsv'
CORPUS_OUT = PROJECT / 'coverage-corpus-la.txt'
MACRON_BREVE = {'\u0304', '\u0306'}


def fold_latin(text: str) -> str:
    nfd = unicodedata.normalize('NFD', text.lower())
    stripped = ''.join(ch for ch in nfd if ch not in MACRON_BREVE)
    return unicodedata.normalize('NFC', stripped).replace('æ', 'ae').replace('œ', 'oe')


def first_lemma(headword: str) -> str:
    token = headword.strip().split()[0] if headword.strip() else ''
    return fold_latin(token.strip('.,;:!?()[]/'))


def fetch_csv() -> str:
    request = urllib.request.Request(
        DCC_CSV,
        headers={'User-Agent': 'lector-language-pack-builder/1.0'},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode('utf-8', errors='replace')


def parse_rows(raw: str) -> list[tuple[str, int]]:
    seen: dict[str, int] = {}
    reader = csv.DictReader(StringIO(raw))
    for row in reader:
        lemma = first_lemma(row.get('Headword') or '')
        rank_raw = row.get('Frequency Rank') or ''
        if not lemma or not lemma.isalpha() or not rank_raw.isdigit():
            continue
        rank = int(rank_raw)
        prev = seen.get(lemma)
        if prev is None or rank < prev:
            seen[lemma] = rank
    return sorted(seen.items(), key=lambda item: item[1])


def main() -> int:
    print(f'Fetching {DCC_CSV}')
    rows = parse_rows(fetch_csv())
    if len(rows) < 800:
        raise RuntimeError(f'only parsed {len(rows)} DCC lemmas (wanted >= 800)')

    TSV_OUT.write_text(
        'lemma\trank\n' + ''.join(f'{lemma}\t{rank}\n' for lemma, rank in rows),
        encoding='utf-8',
    )
    CORPUS_OUT.write_text(
        '# Build-time coverage corpus for build-dictionary.ts --lang la.\n'
        '# Dickinson College Commentaries Latin Core Vocabulary lemmas, macrons\n'
        '# stripped. One per line; "#" = comment.\n'
        '# License: CC BY-SA 3.0. Source: https://dcc.dickinson.edu/latin-core-list1\n'
        '# Regenerate: python scripts/gen-coverage-corpus-la.py\n'
        + '\n'.join(lemma for lemma, _ in rows)
        + '\n',
        encoding='utf-8',
    )
    print(f'wrote {len(rows)} lemmas to {TSV_OUT.name} and {CORPUS_OUT.name}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        print(f'error: {error}', file=sys.stderr)
        raise SystemExit(1)
