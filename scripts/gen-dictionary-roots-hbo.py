#!/usr/bin/env python3
"""Generate curated roots for the hbo dictionary build (rootsJsonRel).

Three jobs, from one OSHB pass:

1. **Frequency ranks** for every Tanakh lemma — lemma counts over OSHB,
   densely ranked. Corpus frequency is the curriculum (#255).
2. **Fallback glosses** from Strong's Hebrew (public domain) for the Biblical
   vocabulary kaikki's mixed Modern/Biblical dump lacks.
3. **Coverage corpus** and **supplemental inflections** (surface → lemma)
   that `build-dictionary.ts --lang hbo` consumes.

    python scripts/gen-dictionary-roots-hbo.py

Downloads cache in tmp/oshb and tmp/HebrewStrong.xml.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

from oshb import (
    HEBREW_LETTERS,
    PROJECT_ROOT,
    fold_hebrew_key,
    load_oshb,
    load_strongs,
    surface_counts,
)

FINALS = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'}


def hebrew_loose_key(key: str) -> str:
    return ''.join(FINALS.get(letter, letter) for letter in key)

SCRIPT_DIR = Path(__file__).resolve().parent
ROOTS_OUT = SCRIPT_DIR / 'dictionary-roots-hbo.json'
COVERAGE_OUT = SCRIPT_DIR / 'coverage-corpus-hbo.txt'
INFL_OUT = SCRIPT_DIR / 'oshb-inflections-hbo.tsv'
COVERAGE_N = 5000


def main() -> int:
    print('=== Biblical Hebrew roots (OSHB + Strong\'s) ===')
    strongs = load_strongs()
    print(f'Strong\'s: {len(strongs)} entries')
    verses, lemma_counts, lemma_pos, lemma_strong = load_oshb(strongs)
    print(f'OSHB: {len(verses)} verses, {len(lemma_counts)} distinct lemmas')

    roots: dict[str, dict[str, object]] = {}
    for rank, (lemma, _count) in enumerate(lemma_counts.most_common(), start=1):
        pos_counts = lemma_pos.get(lemma)
        part_of_speech = pos_counts.most_common(1)[0][0] if pos_counts else ''
        strong_id = lemma_strong[lemma].most_common(1)[0][0] if lemma_strong.get(lemma) else ''
        strong = strongs.get(strong_id)
        if strong and not part_of_speech:
            part_of_speech = strong.pos
        roots[lemma] = {
            'rank': rank,
            'translation': strong.gloss if strong else '',
            'partOfSpeech': part_of_speech,
        }

    ROOTS_OUT.write_text(
        json.dumps(roots, ensure_ascii=False, indent=1) + '\n',
        encoding='utf-8',
    )
    glossed = sum(1 for row in roots.values() if row['translation'])
    print(f'wrote {len(roots)} ranked lemmas to {ROOTS_OUT} ({glossed} with Strong\'s glosses)')

    surfaces = surface_counts(verses)
    words = [word for word, _count in surfaces.most_common(COVERAGE_N)]
    COVERAGE_OUT.write_text(
        '# Build-time coverage corpus for build-dictionary.ts --lang hbo.\n'
        f'# Top-{COVERAGE_N} unpointed surface forms of the Tanakh (OSHB).\n'
        '# One per line; \'#\' = comment.\n'
        '# Regenerate: python scripts/gen-dictionary-roots-hbo.py\n'
        + '\n'.join(words)
        + '\n',
        encoding='utf-8',
    )
    print(f'wrote {len(words)} surfaces to {COVERAGE_OUT}')

    pairs: dict[tuple[str, str], str] = {}
    for tokens in verses.values():
        for token in tokens:
            surface = fold_hebrew_key(token.text)
            lemma = token.lemma
            if surface == lemma:
                continue
            if not HEBREW_LETTERS.fullmatch(surface) or not HEBREW_LETTERS.fullmatch(lemma):
                continue
            key = (surface, lemma)
            if key not in pairs:
                kind = token.pos or 'form'
                pairs[key] = f'oshb,{kind}'

    lines = [
        '# Supplemental hbo inflections from OSHB (CC BY 4.0 analysis).',
        '# inflected_form<TAB>lemma<TAB>type — merged by build-dictionary.ts --lang hbo.',
        '# Regenerate: python scripts/gen-dictionary-roots-hbo.py',
    ]
    for (surface, lemma), kind in sorted(pairs.items()):
        lines.append(f'{surface}\t{lemma}\t{kind}')
    INFL_OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'wrote {len(pairs)} inflection rows to {INFL_OUT}')

    db_path = PROJECT_ROOT / 'data' / 'dictionary-hbo.db'
    db_path.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ('', '-shm', '-wal'):
        extra = Path(str(db_path) + suffix)
        extra.unlink(missing_ok=True)
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            '''
            CREATE TABLE entries (
              word TEXT PRIMARY KEY,
              rank INTEGER,
              ipa TEXT,
              etymology TEXT
            );
            CREATE TABLE senses (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              word TEXT NOT NULL,
              pos TEXT,
              gloss TEXT NOT NULL,
              sort_order INTEGER DEFAULT 0
            );
            CREATE INDEX idx_senses_word ON senses(word);
            CREATE TABLE related_forms (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              word TEXT NOT NULL,
              related_word TEXT NOT NULL,
              relation TEXT NOT NULL
            );
            CREATE INDEX idx_related_word ON related_forms(word);
            CREATE TABLE inflections (
              inflected_form TEXT NOT NULL,
              lemma TEXT NOT NULL,
              type TEXT,
              PRIMARY KEY (inflected_form, lemma)
            );
            CREATE INDEX idx_inflections_lemma ON inflections(lemma);
            '''
        )
        senses = 0
        infl = 0
        for lemma, row in roots.items():
            connection.execute(
                'INSERT INTO entries (word, rank, ipa, etymology) VALUES (?, ?, NULL, NULL)',
                (lemma, row['rank']),
            )
            gloss = str(row['translation'] or lemma)
            connection.execute(
                'INSERT INTO senses (word, pos, gloss, sort_order) VALUES (?, ?, ?, 0)',
                (lemma, row['partOfSpeech'] or None, gloss),
            )
            senses += 1
            loose = hebrew_loose_key(lemma)
            if loose != lemma:
                connection.execute(
                    'INSERT OR IGNORE INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)',
                    (loose, lemma, 'unpointed'),
                )
                infl += 1
        for (surface, lemma), kind in pairs.items():
            connection.execute(
                'INSERT OR IGNORE INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)',
                (surface, lemma, kind),
            )
            infl += 1
            loose = hebrew_loose_key(surface)
            if loose != surface:
                connection.execute(
                    'INSERT OR IGNORE INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)',
                    (loose, lemma, 'unpointed'),
                )
                infl += 1
        connection.commit()
    finally:
        connection.close()
    print(f'wrote Strong\'s dictionary to {db_path} ({len(roots)} entries, {senses} senses, {infl} inflections)')
    return 0


if __name__ == '__main__':
    sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
    raise SystemExit(main())
