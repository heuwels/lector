#!/usr/bin/env python3
"""Build the Arabic Tatoeba cloze bank used by the API.

The output is derived from Tatoeba's `ara` -> `eng` per-language exports
(CC BY 2.0 FR). Candidate words come from wordfreq, are restricted to useful
dictionary parts of speech, exclude proper names and common grammatical words,
and are densely ranked into the top500/top1000/top2000 practice bands. At most
six distinct sentences are retained per target word.

Three things differ from the other packs.

Folding. Every word and every sentence token goes through the same fold the app
uses (foldArabicKey in languages/text.ts): tashkeel and tatweel removed, and
the alef spellings أ إ آ ٱ mapped to bare ا. Without it the frequency list, the
dictionary and the sentences disagree about how to spell the same word — the
list holds both أن and ان — and a blank would ask for a spelling the learner
cannot type.

Proclitics. Arabic writes its conjunctions, prepositions and definite article
onto the front of the word with no space, so مدرسة, المدرسة and وبالمدرسة are
one written token each. A token only matches a candidate when the whole token
folds to it, so a blank for مدرسة is never filled by وبالمدرسة — that would put
three proclitics inside the answer and mark the learner wrong for typing the
word. The article-bearing form can still be a candidate in its OWN right where
the dictionary keys it as a headword, which is how اليوم ("today") gets a
blank, and there the article is part of the word rather than glued to it.

Modern Standard Arabic. Tatoeba's `ara` is MSA, which is what this pack is.
Dialect sentences exist and are not filtered out — there is no reliable marker
for them in the export — so the sentences are MSA in the same sense the rest of
the pack is.

Prerequisites:
    tmp/starter-venv/bin/pip install wordfreq
    npx tsx scripts/build-dictionary.ts --lang ar

Usage:
    tmp/starter-venv/bin/python scripts/build-cloze-ar.py
    tmp/starter-venv/bin/python scripts/build-cloze-ar.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/cloze-ar. Re-running with the same Tatoeba exports,
wordfreq data and dictionary produces the same bank.
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
LANGUAGE_CODE = 'ara'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}

# Arabic letters only, after folding. A token holding a Latin letter, an
# Arabic-Indic digit or Arabic punctuation is not a word the reader tokenizes as
# one, so it can never be a cloze answer.
ARABIC_WORD = re.compile(r'^[ء-غف-ي]+$')

# Keep these three in step with foldArabicKey in languages/text.ts, foldKey in
# scripts/build-dictionary.ts and fold_arabic in
# scripts/gen-coverage-corpus-ar.py. All four must agree or a word keys under a
# spelling the bank never produces.
ARABIC_MARKS = re.compile('[ً-ٰٟۖ-ۭ]')
ARABIC_TATWEEL = 'ـ'
ARABIC_ALEF_VARIANTS = re.compile('[آأإٱ]')

# Keep this aligned with languages/ar/manifest.ts. EVERY ENTRY IS THE FOLDED
# KEY, not the printed spelling — `إلى` is stored as `الى`, and `أن` and `إن`
# both collapse to `ان`. The POS filter removes most function words; this
# explicit list also catches surface forms with a secondary noun or verb sense
# that still make poor cloze targets.
AVOID_WORDS = {
    # free prepositions
    'في', 'من', 'الى', 'على', 'عن', 'مع', 'عند', 'بين', 'حتى', 'ضد', 'نحو',
    'خلال', 'بعد', 'قبل', 'فوق', 'تحت', 'امام', 'خلف', 'وراء', 'دون', 'بدون',
    'حول', 'لدى', 'منذ', 'سوى',
    # conjunctions and subordinators
    'او', 'ثم', 'لكن', 'بل', 'ان', 'انه', 'انها', 'اذا', 'اذ', 'لو', 'كي',
    'لكي', 'حيث', 'لان', 'بينما', 'كما', 'مثل', 'اما', 'اذن',
    # negation
    'لا', 'ما', 'لم', 'لن', 'ليس', 'ليست', 'غير',
    # pronouns
    'انا', 'انت', 'هو', 'هي', 'نحن', 'انتم', 'انتن', 'هم', 'هن', 'هما', 'نفس',
    # demonstratives and place words
    'هذا', 'هذه', 'ذلك', 'تلك', 'هؤلاء', 'اولئك', 'هنا', 'هناك',
    # relatives
    'الذي', 'التي', 'الذين', 'اللاتي', 'اللواتي',
    # interrogatives
    'ماذا', 'متى', 'اين', 'كيف', 'لماذا', 'هل', 'اي', 'كم',
    # quantifiers and degree
    'كل', 'بعض', 'جميع', 'معظم', 'اكثر', 'اقل', 'كثير', 'قليل', 'جدا', 'فقط',
    'ايضا',
    # the copula and the aspect particles that carry no lexical content
    'كان', 'كانت', 'يكون', 'تكون', 'قد', 'لقد', 'سوف', 'نعم', 'ربما',
    # the letter names, which the dump keys as nouns and no learner blanks
    'الف', 'باء', 'تاء', 'جيم', 'دال', 'راء', 'سين', 'عين', 'قاف', 'كاف',
    'لام', 'ميم', 'نون', 'هاء', 'واو', 'ياء',
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
        default=PROJECT_ROOT / 'data' / 'dictionary-ar.db',
        help='Arabic dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-ar',
        help='Tatoeba download/decompression cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-ar.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def normalize(text: str) -> str:
    return unicodedata.normalize('NFC', text)


def fold_arabic(text: str) -> str:
    text = ARABIC_MARKS.sub('', normalize(text))
    text = text.replace(ARABIC_TATWEEL, '')
    return ARABIC_ALEF_VARIANTS.sub('ا', text)


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


def decompress(source: Path) -> Path:
    destination = source.with_suffix('')
    if destination.exists():
        print(f'  cached: {destination.name}')
        return destination
    partial = destination.with_suffix(destination.suffix + '.part')
    print(f'  decompressing {source.name}')
    try:
        with bz2.open(source, 'rb') as compressed, partial.open('wb') as output:
            shutil.copyfileobj(compressed, output, length=1024 * 1024)
        partial.replace(destination)
    finally:
        if partial.exists():
            partial.unlink()
    return destination


def ensure_tatoeba_files(cache_dir: Path) -> tuple[Path, Path, Path]:
    names = (
        f'{LANGUAGE_CODE}_sentences.tsv.bz2',
        f'{LANGUAGE_CODE}-{ENGLISH_CODE}_links.tsv.bz2',
        f'{ENGLISH_CODE}_sentences.tsv.bz2',
    )
    for name in names:
        code = name.split('_', 1)[0].split('-', 1)[0]
        download(f'{TATOEBA_DOWNLOADS}/{code}/{name}', cache_dir / name)
    decompressed = [decompress(cache_dir / name) for name in names]
    return decompressed[0], decompressed[1], decompressed[2]


def useful_dictionary_word(connection: sqlite3.Connection, word: str) -> bool:
    rows = connection.execute('SELECT DISTINCT pos FROM senses WHERE word = ?', (word,)).fetchall()
    parts_of_speech = {row[0] for row in rows if row[0]}
    if not parts_of_speech or 'name' in parts_of_speech:
        return False
    return bool(parts_of_speech & CONTENT_PARTS_OF_SPEECH)


def build_candidates(dictionary_path: Path, max_words: int) -> list[Candidate]:
    if not dictionary_path.exists():
        raise FileNotFoundError(
            f'{dictionary_path} does not exist; run the Arabic dictionary build first'
        )

    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        # Pull a generous frequency window because stop-word, POS and proper-name
        # filtering intentionally removes much of the head of the raw list, and
        # because a large share of the Arabic list is proclitic-bearing surface
        # forms (وبالمدرسة) that carry no dictionary entry of their own.
        for raw_word in top_n_list('ar', max(max_words * 15, 30000)):
            word = fold_arabic(raw_word)
            if (
                word in seen
                or word in AVOID_WORDS
                # A 2-letter Arabic word is a function word, and a 1-letter one
                # is a proclitic that was never a word on its own.
                or len(word) < 3
                or not ARABIC_WORD.fullmatch(word)
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
    with path.open(encoding='utf-8') as source:
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
    with path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            arabic_id, english_id = int(parts[0]), int(parts[1])
            if arabic_id not in sentence_ids:
                continue
            links[arabic_id].append(english_id)
            needed_english.add(english_id)
    return dict(links), needed_english


def load_english(path: Path, needed_ids: set[int]) -> dict[int, str]:
    sentences: dict[int, str] = {}
    with path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            sentence_id = int(parts[0])
            if sentence_id in needed_ids:
                sentences[sentence_id] = normalize(parts[2].strip())
    return sentences


def token_key(raw_token: str) -> str:
    # Unicode punctuation and symbols at the outside are display-only: the
    # Arabic comma ،, the Arabic question mark ؟, guillemets and the Latin marks
    # Tatoeba mixes in. Nothing INSIDE the token is split, unlike Turkish: an
    # Arabic proclitic is written with no separator at all, so there is nothing
    # to split on, and a token carrying one is deliberately left unmatched.
    start = 0
    end = len(raw_token)
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        end -= 1
    return fold_arabic(raw_token[start:end])


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
    arabic: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_words = {candidate.word for candidate in candidates}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(arabic):
        text = arabic[sentence_id]
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

    print('=== Arabic Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.max_words)
    arabic_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    arabic = load_sentences(arabic_path)
    links, needed_english = load_links(links_path, set(arabic))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(arabic)} length-filtered Arabic sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    options = collect_options(arabic, links, english, candidates)
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
