#!/usr/bin/env python3
"""Build the Modern Hebrew Tatoeba cloze bank used by the API.

The output is derived from Tatoeba's `heb` -> `eng` per-language exports
(CC BY 2.0 FR). Candidate words come from wordfreq, are restricted to useful
dictionary parts of speech, exclude proper names and common grammatical words,
and are densely ranked into the top500/top1000/top2000 practice bands. At most
six distinct sentences are retained per target word.

Folding. Every word and every sentence token goes through foldHebrewKey from
languages/text.ts: niqqud and cantillation removed, and geresh and gershayim
keyed as the Hebrew marks.

Prefixes. Hebrew writes its conjunction, article and short prepositions onto
the word. A token only matches a candidate when the whole token folds to it, so
a blank for ילד is never filled by והילד.

Prerequisites:
    tmp/starter-venv/bin/pip install wordfreq
    npx tsx scripts/build-dictionary.ts --lang he

Usage:
    tmp/starter-venv/bin/python scripts/build-cloze-he.py

Downloads are cached in tmp/cloze-he and read compressed. Re-running with the
same Tatoeba exports, wordfreq data and dictionary produces the same bank.
"""

from __future__ import annotations

import argparse
import bz2
import json
import re
import shutil
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from wordfreq import top_n_list


PROJECT_ROOT = Path(__file__).resolve().parent.parent
TATOEBA_DOWNLOADS = 'https://downloads.tatoeba.org/exports/per_language'
LANGUAGE_CODE = 'heb'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}

HEBREW_WORD = re.compile('^[\u05D0-\u05EA][\u05D0-\u05EA\u05F3\u05F4]*$')

# Keep in step with foldHebrewKey in languages/text.ts and fold in
# scripts/gen-coverage-corpus-he.py.
HEBREW_MARKS = re.compile('[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]')
HEBREW_GERESH = re.compile("['\u2018\u2019`\u00B4]")
HEBREW_GERSHAYIM = re.compile('["\u201C\u201D]')

# Keep this aligned with languages/he/manifest.ts.
AVOID_WORDS = {
    'את', 'של', 'על', 'אל', 'עם', 'עד', 'בין', 'אחרי', 'לפני', 'תחת', 'בלי', 'ללא',
    'אצל', 'כמו', 'מן', 'בשביל', 'בגלל', 'לגבי', 'נגד', 'ליד', 'מול', 'דרך', 'לי', 'לך',
    'לו', 'לה', 'לנו', 'לכם', 'להם', 'להן', 'אותי', 'אותך', 'אותו', 'אותה', 'אותנו',
    'אותם', 'אותן', 'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלכם', 'שלהם', 'שלהן', 'בו',
    'בה', 'בהם', 'ממני', 'ממנו', 'עליו', 'עליה', 'איתו', 'איתה', 'איתי', 'כי', 'אם',
    'או', 'גם', 'אבל', 'אך', 'רק', 'אשר', 'לכן', 'כאשר', 'כש', 'כדי', 'למרות', 'אלא',
    'אז', 'לא', 'אין', 'יש', 'אני', 'אתה', 'אתם', 'אתן', 'אנחנו', 'הוא', 'היא', 'הם',
    'הן', 'זה', 'זאת', 'זו', 'אלה', 'אלו', 'עצמו', 'מה', 'מי', 'איך', 'איפה', 'מתי',
    'למה', 'מדוע', 'כמה', 'האם', 'איזה', 'איזו', 'כל', 'הכל', 'כן', 'עוד', 'כבר',
    'מאוד', 'יותר', 'פחות', 'הרבה', 'קצת', 'כך', 'ככה', 'פה', 'כאן', 'שם', 'עכשיו',
    'אולי', 'בדיוק', 'סתם', 'בכלל', 'הזה', 'הזאת', 'האלה', 'כזה', 'כזאת', 'בזה', 'מזה',
    'לזה', 'שהם', 'שהוא', 'שהיא', 'וכן', 'ידי', 'אי', 'שום', 'אף', 'די', 'כאילו',
    'עבור', 'מתוך', 'היה', 'היתה', 'הייתה', 'היו', 'יהיה', 'תהיה', 'להיות',
}


@dataclass(frozen=True)
class Candidate:
    word: str
    rank: int


@dataclass(frozen=True)
class SentenceOption:
    sentence_id: int
    text: str
    translation: str
    cloze_word: str
    cloze_index: int
    score: tuple[int, int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--dictionary',
        type=Path,
        default=PROJECT_ROOT / 'data' / 'dictionary-he.db',
        help='Hebrew dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-he',
        help='Tatoeba download cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-he.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def normalize(text: str) -> str:
    return unicodedata.normalize('NFC', text)


def fold_hebrew(text: str) -> str:
    text = HEBREW_MARKS.sub('', normalize(text))
    text = HEBREW_GERESH.sub('\u05F3', text)
    return HEBREW_GERSHAYIM.sub('\u05F4', text)


def download(url: str, destination: Path) -> None:
    if destination.exists():
        print(f'  cached: {destination.name}')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + '.part')
    print(f'  downloading {url}')
    request = urllib.request.Request(url, headers={'User-Agent': 'lector-language-pack-builder/1.0'})
    try:
        with urllib.request.urlopen(request) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        partial.replace(destination)
    finally:
        if partial.exists():
            partial.unlink()
    print(f'  wrote {destination.stat().st_size / 1024 / 1024:.1f} MB: {destination.name}')


def ensure_tatoeba_files(cache_dir: Path) -> tuple[Path, Path, Path]:
    names = (
        f'{LANGUAGE_CODE}_sentences.tsv.bz2',
        f'{LANGUAGE_CODE}-{ENGLISH_CODE}_links.tsv.bz2',
        f'{ENGLISH_CODE}_sentences.tsv.bz2',
    )
    for name in names:
        code = name.split('_', 1)[0].split('-', 1)[0]
        download(f'{TATOEBA_DOWNLOADS}/{code}/{name}', cache_dir / name)
    return cache_dir / names[0], cache_dir / names[1], cache_dir / names[2]


def useful_dictionary_word(connection: sqlite3.Connection, word: str) -> bool:
    rows = connection.execute('SELECT DISTINCT pos FROM senses WHERE word = ?', (word,)).fetchall()
    parts_of_speech = {row[0] for row in rows if row[0]}
    if not parts_of_speech or 'name' in parts_of_speech:
        return False
    return bool(parts_of_speech & CONTENT_PARTS_OF_SPEECH)


def build_candidates(dictionary_path: Path, max_words: int) -> list[Candidate]:
    if not dictionary_path.exists():
        raise FileNotFoundError(
            f'{dictionary_path} does not exist; run the Hebrew dictionary build first'
        )

    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        # Pull a generous frequency window because stop-word, POS and proper-name
        # filtering removes much of the head of the list, and because many
        # Hebrew tokens carry a prefix and have no entry of their own.
        for raw_word in top_n_list('he', max(max_words * 15, 30000)):
            word = fold_hebrew(raw_word)
            if (
                word in seen
                or word in AVOID_WORDS
                or len(word) < 2
                or not HEBREW_WORD.fullmatch(word)
                or not useful_dictionary_word(connection, word)
            ):
                continue
            seen.add(word)
            candidates.append(Candidate(word=word, rank=len(candidates) + 1))
            if len(candidates) == max_words:
                break
    finally:
        connection.close()

    if len(candidates) < max_words:
        print(f'note: only found {len(candidates)} usable candidates (wanted {max_words})')
    print(f'Candidates: {len(candidates)} content words (proper names excluded)')
    return candidates


def load_sentences(path: Path) -> dict[int, str]:
    sentences: dict[int, str] = {}
    with bz2.open(path, 'rt', encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            sentence_id = int(parts[0])
            text = normalize(parts[2].strip())
            word_count = len(text.split())
            if MIN_SENTENCE_WORDS <= word_count <= MAX_SENTENCE_WORDS:
                sentences[sentence_id] = text
    return sentences


def load_links(path: Path, sentence_ids: set[int]) -> tuple[dict[int, list[int]], set[int]]:
    links: dict[int, list[int]] = defaultdict(list)
    needed_english: set[int] = set()
    with bz2.open(path, 'rt', encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            hebrew_id, english_id = int(parts[0]), int(parts[1])
            if hebrew_id not in sentence_ids:
                continue
            links[hebrew_id].append(english_id)
            needed_english.add(english_id)
    return dict(links), needed_english


def load_english(path: Path, needed_ids: set[int]) -> dict[int, str]:
    sentences: dict[int, str] = {}
    with bz2.open(path, 'rt', encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            sentence_id = int(parts[0])
            if sentence_id in needed_ids:
                sentences[sentence_id] = normalize(parts[2].strip())
    return sentences


def token_key(raw_token: str) -> str:
    # Punctuation and symbols at the outside are display-only. A gershayim
    # inside a token stays, because it is part of an acronym (צה"ל).
    start = 0
    end = len(raw_token)
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        end -= 1
    return fold_hebrew(raw_token[start:end])


def sentence_matches(text: str, candidate_words: set[str]) -> dict[str, tuple[str, int]]:
    matches: dict[str, tuple[str, int]] = {}
    for index, raw_token in enumerate(text.split()):
        key = token_key(raw_token)
        if key in candidate_words and key not in matches:
            matches[key] = (raw_token, index)
    return matches


def first_translation(english_ids: list[int], english: dict[int, str]) -> str | None:
    for sentence_id in english_ids:
        translation = english.get(sentence_id)
        if translation:
            return translation
    return None


def collect_options(
    hebrew: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_words = {candidate.word for candidate in candidates}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(hebrew):
        text = hebrew[sentence_id]
        if text in seen_texts:
            continue
        translation = first_translation(links.get(sentence_id, []), english)
        if not translation:
            continue
        matches = sentence_matches(text, candidate_words)
        if not matches:
            continue
        seen_texts.add(text)
        word_count = len(text.split())
        translation_words = len(translation.split())
        score = (abs(word_count - 8), abs(translation_words - 8), sentence_id)
        for word, (raw_token, index) in matches.items():
            options[word].append(
                SentenceOption(
                    sentence_id=sentence_id,
                    text=text,
                    translation=translation,
                    cloze_word=raw_token,
                    cloze_index=index,
                    score=score,
                )
            )

    for word in options:
        options[word] = sorted(options[word], key=lambda option: option.score)[
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
    used_sentence_ids: set[int] = set()

    # Give scarce words first pick of their few usable sentences. Common words
    # are processed later but have enough alternatives to avoid collisions.
    by_scarcity = sorted(
        candidates,
        key=lambda candidate: (len(options.get(candidate.word, [])), candidate.rank),
    )
    for candidate in by_scarcity:
        for option in options.get(candidate.word, []):
            if option.sentence_id in used_sentence_ids:
                continue
            selected[candidate.rank].append(option)
            used_sentence_ids.add(option.sentence_id)
            if len(selected[candidate.rank]) == sentences_per_word:
                break

    bank: list[dict[str, object]] = []
    for candidate in candidates:
        for option in sorted(selected.get(candidate.rank, []), key=lambda item: item.score):
            bank.append(
                {
                    'id': option.sentence_id,
                    'text': option.text,
                    'translation': option.translation,
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

    print('=== Modern Hebrew Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.max_words)
    hebrew_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    hebrew = load_sentences(hebrew_path)
    links, needed_english = load_links(links_path, set(hebrew))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(hebrew)} length-filtered Hebrew sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    options = collect_options(hebrew, links, english, candidates)
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
