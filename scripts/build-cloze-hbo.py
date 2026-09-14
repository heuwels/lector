#!/usr/bin/env python3
"""Build the Biblical Hebrew cloze bank from verse-aligned scripture (#255).

Tatoeba `heb` and wordfreq `he` are Modern Hebrew, so the bank comes from the
Tanakh itself: OSHB verses (per-word lemma) aligned to the World English Bible
(public domain) by verse reference. Every row keeps its verse ref as
provenance, appended to the translation.

Candidate words are the most frequent Tanakh lemmas, restricted to content
parts of speech, excluding proper names and grammatical words. Long verses
split on sof pasuq and strong punctuation into segments of readable length.
At most six segments are retained per target lemma; each segment is used for
only one target.

    python scripts/build-cloze-hbo.py
    python scripts/build-cloze-hbo.py --max-words 2000 --sentences-per-word 6

Downloads cache in tmp/oshb, tmp/HebrewStrong.xml, and tmp/cloze-hbo.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from oshb import (
    BOOKS,
    PROJECT_ROOT,
    Token,
    fetch,
    load_oshb,
    load_strongs,
)

# ebible.org timed out from this host. WEBU is the same public-domain text,
# already verse-split on GitHub.
WEBU_JSON = (
    'https://raw.githubusercontent.com/ringletech/webu-open-bible/main/json/complete-bible.json'
)

MIN_SEGMENT_WORDS = 4
MAX_SEGMENT_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_POS = {'noun', 'verb', 'adj', 'adv'}
STRONG_PUNCT = re.compile(r'[.!?׃]$')

# Keep this aligned with languages/hbo/manifest.ts — unpointed keys, finals kept.
AVOID_WORDS = {
    'את', 'על', 'אל', 'מן', 'עד', 'עם', 'בין', 'אחר', 'אחרי', 'לפני', 'תחת',
    'מפני', 'כי', 'אם', 'או', 'גם', 'אך', 'רק', 'אשר', 'לכן', 'פן', 'לא',
    'אין', 'יש', 'אני', 'אתה', 'אתם', 'אתן', 'אנחנו', 'הוא', 'היא', 'הם',
    'הן', 'זה', 'זאת', 'אלה', 'מה', 'מי', 'למה', 'מדוע', 'כל', 'כן', 'הנה',
    'עתה', 'נא', 'היה', 'היו', 'יהי',
}


@dataclass(frozen=True)
class Candidate:
    lemma: str
    rank: int


@dataclass(frozen=True)
class Segment:
    segment_id: int
    ref: str
    tokens: tuple[Token, ...]
    translation: str


@dataclass(frozen=True)
class SentenceOption:
    segment: Segment
    cloze_word: str
    cloze_index: int
    score: tuple[int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-hbo',
        help='WEB translation download cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-hbo.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def load_web_verses(cache_dir: Path) -> dict[tuple[str, int, int], str]:
    """WEB/WEBU verse text keyed by (display name, chapter, verse)."""
    path = fetch(WEBU_JSON, cache_dir / 'complete-bible.json')
    rows = json.loads(path.read_text(encoding='utf-8'))
    verses: dict[tuple[str, int, int], str] = {}
    for row in rows:
        book = row.get('book')
        text = (row.get('text') or '').strip()
        if not book or not text:
            continue
        verses[(book, int(row['chapter']), int(row['verse']))] = text
    return verses


def build_candidates(
    lemma_counts,
    lemma_pos,
    max_words: int,
) -> list[Candidate]:
    candidates: list[Candidate] = []
    for lemma, _count in lemma_counts.most_common():
        if len(candidates) == max_words:
            break
        if lemma in AVOID_WORDS or len(lemma) < 2:
            continue
        pos_counts = lemma_pos.get(lemma)
        if not pos_counts:
            continue
        pos = pos_counts.most_common(1)[0][0]
        if pos == 'name' or pos not in CONTENT_POS:
            continue
        candidates.append(Candidate(lemma=lemma, rank=len(candidates) + 1))
    print(f'Candidates: {len(candidates)} content lemmas (proper names excluded)')
    return candidates


def segment_verse(tokens: list[Token]) -> list[tuple[int, list[Token]]]:
    if len(tokens) <= MAX_SEGMENT_WORDS:
        segments = [tokens]
    else:
        segments = []
        current: list[Token] = []
        for token in tokens:
            current.append(token)
            if STRONG_PUNCT.search(token.text) and len(current) >= MIN_SEGMENT_WORDS:
                segments.append(current)
                current = []
        if current:
            segments.append(current)
    return [
        (index, segment)
        for index, segment in enumerate(segments)
        if MIN_SEGMENT_WORDS <= len(segment) <= MAX_SEGMENT_WORDS
    ]


def collect_options(
    verses: dict[tuple[int, int, int], list[Token]],
    web: dict[tuple[str, int, int], str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_lemmas = {candidate.lemma for candidate in candidates}
    web_codes = {number: (code, name) for _file, number, code, name in BOOKS}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    skipped_untranslated = 0

    for (book, chapter, verse), tokens in sorted(verses.items()):
        _code, name = web_codes[book]
        translation = web.get((name, chapter, verse))
        if not translation:
            skipped_untranslated += 1
            continue
        ref = f'{name} {chapter}:{verse}'
        for segment_index, segment_tokens in segment_verse(tokens):
            segment = Segment(
                segment_id=((book * 1000 + chapter) * 1000 + verse) * 10 + segment_index,
                ref=ref,
                tokens=tuple(segment_tokens),
                translation=f'{translation} ({ref})',
            )
            matched: set[str] = set()
            for index, token in enumerate(segment_tokens):
                if token.lemma in candidate_lemmas and token.lemma not in matched:
                    matched.add(token.lemma)
                    score = (abs(len(segment_tokens) - 8), segment.segment_id)
                    options[token.lemma].append(
                        SentenceOption(
                            segment=segment,
                            cloze_word=token.text,
                            cloze_index=index,
                            score=score,
                        )
                    )

    if skipped_untranslated:
        print(f'  ({skipped_untranslated} verses without a WEB counterpart skipped)')
    for lemma in options:
        options[lemma] = sorted(options[lemma], key=lambda option: option.score)[
            :MAX_OPTIONS_PER_WORD
        ]
    return dict(options)


def collection_for_rank(rank: int) -> str:
    if rank <= 500:
        return 'top500'
    if rank <= 1000:
        return 'top1000'
    return 'top2000'


def select_bank(
    candidates: list[Candidate],
    options: dict[str, list[SentenceOption]],
    sentences_per_word: int,
) -> list[dict[str, object]]:
    selected: dict[int, list[SentenceOption]] = defaultdict(list)
    used_segment_ids: set[int] = set()

    by_scarcity = sorted(
        candidates,
        key=lambda candidate: (len(options.get(candidate.lemma, [])), candidate.rank),
    )
    for candidate in by_scarcity:
        for option in options.get(candidate.lemma, []):
            if option.segment.segment_id in used_segment_ids:
                continue
            selected[candidate.rank].append(option)
            used_segment_ids.add(option.segment.segment_id)
            if len(selected[candidate.rank]) == sentences_per_word:
                break

    bank: list[dict[str, object]] = []
    for candidate in candidates:
        for option in sorted(selected.get(candidate.rank, []), key=lambda item: item.score):
            text = ' '.join(token.text for token in option.segment.tokens)
            if not text.endswith('׃'):
                text = f'{text}׃'
            bank.append(
                {
                    'id': option.segment.segment_id,
                    'text': text,
                    'translation': option.segment.translation,
                    'clozeWord': option.cloze_word,
                    'clozeIndex': option.cloze_index,
                    'wordRank': candidate.rank,
                    'collection': collection_for_rank(candidate.rank),
                }
            )
    return bank


def main() -> int:
    args = parse_args()
    if args.max_words < 1 or args.sentences_per_word < 1:
        raise ValueError('--max-words and --sentences-per-word must be positive')

    print('=== Biblical Hebrew verse-aligned cloze builder ===')
    strongs = load_strongs()
    verses, lemma_counts, lemma_pos, _lemma_strong = load_oshb(strongs)
    print(f'OSHB: {len(verses)} verses, {len(lemma_counts)} distinct lemmas')
    candidates = build_candidates(lemma_counts, lemma_pos, args.max_words)
    web = load_web_verses(args.cache_dir)
    print(f'WEB: {len(web)} translated verses loaded')

    options = collect_options(verses, web, candidates)
    bank = select_bank(candidates, options, args.sentences_per_word)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', encoding='utf-8') as output:
        json.dump(bank, output, ensure_ascii=False, indent=0)
        output.write('\n')

    covered_ranks = {row['wordRank'] for row in bank}
    collections: dict[str, int] = defaultdict(int)
    for row in bank:
        collections[str(row['collection'])] += 1

    print(f'Wrote {len(bank)} rows to {args.output}')
    print(
        f'Target coverage: {len(covered_ranks)}/{len(candidates)} '
        f'({len(covered_ranks) / len(candidates):.1%})'
    )
    for collection in ('top500', 'top1000', 'top2000'):
        print(f'  {collection}: {collections[collection]}')
    return 0


if __name__ == '__main__':
    sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
    raise SystemExit(main())
