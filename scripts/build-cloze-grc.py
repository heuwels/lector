#!/usr/bin/env python3
"""Build the Koine Greek cloze bank from verse-aligned scripture (#254).

Tatoeba `grc` is unusable (~1.8k sentences), so the bank comes from the target
corpus itself: Greek NT verses (MorphGNT/SBLGNT — per-word lemma, so targets
match by LEMMA, not surface form) aligned to the World English Bible (public
domain) by verse reference. Every row keeps its verse ref as provenance,
appended to the translation — this audience wants it.

Candidate words are the most frequent NT lemmas, restricted to content parts
of speech, excluding proper names (dictionary POS "name") and grammatical
words. Long verses are split on strong punctuation (. · ;) into segments of
readable length. At most six segments are retained per target lemma; each
segment is used for only one target.

Prerequisites:
    npx tsx scripts/build-dictionary.ts --lang grc

Usage:
    python scripts/build-cloze-grc.py
    python scripts/build-cloze-grc.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/morphgnt (shared with the grc generators) and
tmp/cloze-grc. Re-running with the same inputs produces the same bank.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MORPHGNT_RAW = 'https://raw.githubusercontent.com/morphgnt/sblgnt/master'
WEB_VPL_ZIP = 'https://ebible.org/Scriptures/engwebp_vpl.zip'
MORPHGNT_CACHE = PROJECT_ROOT / 'tmp' / 'morphgnt'

MIN_SEGMENT_WORDS = 4
MAX_SEGMENT_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_POS = {'N-', 'V-', 'A-', 'D-'}
DICT_CONTENT_POS = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
GREEK_WORD = re.compile(r'^[Ͱ-Ͽἀ-῿]+$')
STRONG_PUNCT = re.compile(r'[.;·]$')
# SBLGNT textual-apparatus sigla (⸀ ⸂ ⸄ …, U+2E00–U+2E0F) attach to tokens in
# the MorphGNT text column — editorial machinery, not reading text.
CRITICAL_SIGLA = re.compile(r'[⸀-⸏]')

# (file prefix, MorphGNT book number, WEB VPL code, display name)
BOOKS = [
    ('61-Mt', 1, 'MAT', 'Matthew'), ('62-Mk', 2, 'MAR', 'Mark'),
    ('63-Lk', 3, 'LUK', 'Luke'), ('64-Jn', 4, 'JOH', 'John'),
    ('65-Ac', 5, 'ACT', 'Acts'), ('66-Ro', 6, 'ROM', 'Romans'),
    ('67-1Co', 7, '1CO', '1 Corinthians'), ('68-2Co', 8, '2CO', '2 Corinthians'),
    ('69-Ga', 9, 'GAL', 'Galatians'), ('70-Eph', 10, 'EPH', 'Ephesians'),
    ('71-Php', 11, 'PHI', 'Philippians'), ('72-Col', 12, 'COL', 'Colossians'),
    ('73-1Th', 13, '1TH', '1 Thessalonians'), ('74-2Th', 14, '2TH', '2 Thessalonians'),
    ('75-1Ti', 15, '1TI', '1 Timothy'), ('76-2Ti', 16, '2TI', '2 Timothy'),
    ('77-Tit', 17, 'TIT', 'Titus'), ('78-Phm', 18, 'PHM', 'Philemon'),
    ('79-Heb', 19, 'HEB', 'Hebrews'), ('80-Jas', 20, 'JAM', 'James'),
    ('81-1Pe', 21, '1PE', '1 Peter'), ('82-2Pe', 22, '2PE', '2 Peter'),
    ('83-1Jn', 23, '1JO', '1 John'), ('84-2Jn', 24, '2JO', '2 John'),
    ('85-3Jn', 25, '3JO', '3 John'), ('86-Jud', 26, 'JUD', 'Jude'),
    ('87-Re', 27, 'REV', 'Revelation'),
]

# Keep this aligned with languages/grc/manifest.ts — folded (lowercase NFC).
AVOID_WORDS = {
    'ὁ', 'ἡ', 'τό', 'τοῦ', 'τῆς', 'τῷ', 'τῇ', 'τόν', 'τήν', 'οἱ', 'αἱ', 'τά',
    'τῶν', 'τοῖς', 'ταῖς', 'τούς', 'τάς',
    'καί', 'δέ', 'γάρ', 'ἀλλά', 'οὖν', 'τε', 'γε', 'ἄν', 'ἐάν', 'εἰ', 'ὅτι',
    'ἵνα', 'ὡς', 'ὥστε', 'μέν', 'οὐ', 'οὐκ', 'οὐχ', 'οὐχί', 'μή', 'μηδέ',
    'οὐδέ', 'ἤ', 'ἰδού',
    'ἐν', 'εἰς', 'ἐκ', 'ἐξ', 'ἀπό', 'διά', 'ἐπί', 'κατά', 'μετά', 'παρά',
    'περί', 'πρό', 'πρός', 'σύν', 'ὑπό', 'ὑπέρ', 'ἀντί', 'ἕως', 'ἄχρι', 'χωρίς',
    'ἐγώ', 'μου', 'ἐμοῦ', 'μοι', 'ἐμοί', 'με', 'ἐμέ', 'σύ', 'σου', 'σοῦ',
    'σοι', 'σοί', 'σε', 'σέ', 'ἡμεῖς', 'ἡμῶν', 'ἡμῖν', 'ἡμᾶς', 'ὑμεῖς', 'ὑμῶν',
    'ὑμῖν', 'ὑμᾶς', 'αὐτός', 'αὐτή', 'αὐτό', 'αὐτοῦ', 'αὐτῆς', 'αὐτῷ', 'αὐτῇ',
    'αὐτόν', 'αὐτήν', 'αὐτοί', 'αὐταί', 'αὐτά', 'αὐτῶν', 'αὐτοῖς', 'αὐταῖς',
    'αὐτούς', 'αὐτάς',
    'ὅς', 'ἥ', 'ὅ', 'οὗ', 'ἧς', 'ᾧ', 'ᾗ', 'ὅν', 'ἥν', 'ὧν', 'οἷς', 'αἷς',
    'οὕς', 'ἅς', 'ἅ', 'τίς', 'τί', 'τίνος', 'τίνι', 'τίνα', 'τις', 'τι',
    'τινός', 'τινί', 'τινά', 'οὗτος', 'αὕτη', 'τοῦτο', 'τούτου', 'ταύτης',
    'τούτῳ', 'ταύτῃ', 'τοῦτον', 'ταύτην', 'οὗτοι', 'αὗται', 'ταῦτα', 'τούτων',
    'τούτοις', 'ταύταις', 'τούτους', 'ταύτας', 'ἐκεῖνος', 'ἐκείνη', 'ἐκεῖνο',
    'ὅδε', 'ἥδε', 'τόδε', 'πᾶς', 'πᾶσα', 'πᾶν', 'παντός', 'πάσης', 'παντί',
    'πάσῃ', 'πάντα', 'πᾶσαν', 'πάντες', 'πᾶσαι', 'πάντων', 'πασῶν', 'πᾶσιν',
    'πάσαις', 'πάντας', 'πάσας',
    'εἰμί', 'εἶ', 'ἐστίν', 'ἐστιν', 'ἐστί', 'ἐστε', 'ἐσμέν', 'εἰσίν', 'εἰσιν',
    'ἦν', 'ἦς', 'ἦσαν', 'ἦμεν', 'ἔσται', 'ἔσονται', 'εἶναι', 'ὤν', 'οὖσα', 'ὄν',
    'κατ', 'μετ', 'παρ', 'δι', 'ἐπ', 'ὑπ', 'ἀπ', 'ἀφ', 'ἐφ', 'ὑφ', 'μεθ',
    'καθ', 'ἀνθ', 'ἀλλ', 'οὐδ', 'μηδ', 'δ', 'τ', 'θ',
}


@dataclass(frozen=True)
class Token:
    text: str  # as printed, punctuation attached
    lemma: str  # folded


@dataclass(frozen=True)
class Segment:
    segment_id: int  # numeric: ((book*1000+ch)*1000+v)*10 + index
    ref: str  # "John 1:1"
    tokens: tuple[Token, ...]
    translation: str  # WEB verse + provenance


@dataclass(frozen=True)
class Candidate:
    lemma: str
    rank: int


@dataclass(frozen=True)
class SentenceOption:
    segment: Segment
    cloze_word: str
    cloze_index: int
    score: tuple[int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--dictionary',
        type=Path,
        default=PROJECT_ROOT / 'data' / 'dictionary-grc.db',
        help='Greek dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-grc',
        help='WEB translation download cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-grc.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def fold(word: str) -> str:
    return unicodedata.normalize('NFC', word).lower()


def fetch(url: str, destination: Path) -> Path:
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f'  downloading {url}')
    request = urllib.request.Request(url, headers={'User-Agent': 'lector-language-pack-builder/1.0'})
    with urllib.request.urlopen(request) as response, destination.open('wb') as out:
        out.write(response.read())
    return destination


def load_web_verses(cache_dir: Path) -> dict[tuple[str, int, int], str]:
    """WEB verse text keyed by (book code, chapter, verse)."""
    zip_path = fetch(WEB_VPL_ZIP, cache_dir / 'engwebp_vpl.zip')
    verses: dict[tuple[str, int, int], str] = {}
    line_re = re.compile(r'^([0-9A-Z]{3}) (\d+):(\d+)\s+(.*)$')
    with zipfile.ZipFile(zip_path) as archive:
        vpl_name = next(n for n in archive.namelist() if n.endswith('_vpl.txt'))
        with archive.open(vpl_name) as raw:
            for line in io.TextIOWrapper(raw, encoding='utf-8-sig'):
                match = line_re.match(line.strip())
                if not match:
                    continue
                book, chapter, verse, text = match.groups()
                if text:
                    verses[(book, int(chapter), int(verse))] = text.strip()
    return verses


def load_morphgnt() -> tuple[dict[tuple[int, int, int], list[Token]], Counter[str], dict[str, Counter[str]]]:
    """Verse tokens, lemma counts and per-lemma POS counts over the GNT."""
    verses: dict[tuple[int, int, int], list[Token]] = defaultdict(list)
    lemma_counts: Counter[str] = Counter()
    lemma_pos: dict[str, Counter[str]] = defaultdict(Counter)
    for file_prefix, book_number, _web, _name in BOOKS:
        path = MORPHGNT_CACHE / f'{file_prefix}-morphgnt.txt'
        fetch(f'{MORPHGNT_RAW}/{file_prefix}-morphgnt.txt', path)
        for line in path.read_text(encoding='utf-8').splitlines():
            columns = line.split()
            if len(columns) != 7:
                continue
            bcv = columns[0]
            chapter, verse = int(bcv[2:4]), int(bcv[4:6])
            lemma = fold(columns[6])
            text = CRITICAL_SIGLA.sub('', unicodedata.normalize('NFC', columns[3]))
            verses[(book_number, chapter, verse)].append(Token(text=text, lemma=lemma))
            if GREEK_WORD.fullmatch(lemma):
                lemma_counts[lemma] += 1
                lemma_pos[lemma][columns[1]] += 1
    return dict(verses), lemma_counts, lemma_pos


def useful_dictionary_word(connection: sqlite3.Connection, word: str) -> bool:
    rows = connection.execute('SELECT DISTINCT pos FROM senses WHERE word = ?', (word,)).fetchall()
    parts_of_speech = {row[0] for row in rows if row[0]}
    if not parts_of_speech or 'name' in parts_of_speech:
        return False
    return bool(parts_of_speech & DICT_CONTENT_POS)


def build_candidates(
    dictionary_path: Path,
    lemma_counts: Counter[str],
    lemma_pos: dict[str, Counter[str]],
    max_words: int,
) -> list[Candidate]:
    if not dictionary_path.exists():
        raise FileNotFoundError(
            f'{dictionary_path} does not exist; run the Greek dictionary build first'
        )
    candidates: list[Candidate] = []
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        for lemma, _count in lemma_counts.most_common():
            if len(candidates) == max_words:
                break
            if lemma in AVOID_WORDS or len(lemma) < 2:
                continue
            if lemma_pos[lemma].most_common(1)[0][0] not in CONTENT_POS:
                continue
            if not useful_dictionary_word(connection, lemma):
                continue
            candidates.append(Candidate(lemma=lemma, rank=len(candidates) + 1))
    finally:
        connection.close()
    print(f'Candidates: {len(candidates)} content lemmas (proper names excluded)')
    return candidates


def segment_verse(tokens: list[Token]) -> list[tuple[int, list[Token]]]:
    """Split an over-long verse on strong punctuation; keep readable segments."""
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
    web_codes = {number: (code, name) for _p, number, code, name in BOOKS}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    skipped_untranslated = 0

    for (book, chapter, verse), tokens in sorted(verses.items()):
        code, name = web_codes[book]
        translation = web.get((code, chapter, verse))
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

    # Scarce lemmas pick first — common ones have plenty of alternatives.
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
            bank.append(
                {
                    'id': option.segment.segment_id,
                    'text': ' '.join(token.text for token in option.segment.tokens),
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

    print('=== Koine Greek verse-aligned cloze builder ===')
    verses, lemma_counts, lemma_pos = load_morphgnt()
    print(f'MorphGNT: {len(verses)} verses, {len(lemma_counts)} distinct lemmas')
    candidates = build_candidates(args.dictionary, lemma_counts, lemma_pos, args.max_words)
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
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, sqlite3.Error, urllib.error.URLError) as error:
        print(f'error: {error}', file=sys.stderr)
        raise SystemExit(1)
