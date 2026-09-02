#!/usr/bin/env python3
"""Build the Scottish Gaelic Tatoeba cloze bank used by the API.

Tatoeba `gla` is small (~1,000 English pairs). Frequency has no wordfreq
list: Wikipedia token counts rank the spine. The bank will be smaller than
the European packs. That is expected.

Prerequisites:
    python scripts/gen-gd-wiki-freq.py
    npx tsx scripts/build-dictionary.ts --lang gd

Usage:
    python scripts/build-cloze-gd.py
    python scripts/build-cloze-gd.py --max-words 2000 --sentences-per-word 6
"""

from __future__ import annotations

import argparse
import bz2
import csv
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

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TATOEBA_DOWNLOADS = 'https://downloads.tatoeba.org/exports/per_language'
LANGUAGE_CODE = 'gla'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
GAELIC_WORD = re.compile(r"^[a-zàèìòù]+(?:'[a-zàèìòù]+)*(?:-[a-zàèìòù]+)*$")
APOSTROPHES = str.maketrans({'’': "'", 'ʼ': "'", '‘': "'", '`': "'", '´': "'", 'ʹ': "'"})

# Keep this aligned with languages/gd/manifest.ts.
AVOID_WORDS = {
    'an', 'am', "a'", 'na', 'nan', 'nam',
    'air', 'aig', 'ri', 'le', 'do', 'de', 'fo', 'mu', 'bho', 'o', 'tro',
    'gun', 'às', 'ann', 'anns', 'eadar', 'thar', 'seach', 'gu', 'gus',
    'orm', 'ort', 'oirnn', 'oirbh', 'orra',
    'agam', 'agad', 'aige', 'aice', 'againn', 'agaibh', 'aca',
    'rium', 'riut', 'ris', 'rithe', 'rinn', 'ribh', 'riutha',
    'leam', 'leat', 'leis', 'leatha', 'leinn', 'leibh', 'leotha',
    'dhomh', 'dhut', 'dha', 'dhi', 'dhuinn', 'dhuibh', 'dhaibh',
    'mi', 'thu', 'e', 'i', 'sinn', 'sibh', 'iad',
    'mo', 'do', 'ar', 'ur',
    'tha', 'bha', 'bidh', 'bhiodh', 'bi', 'is', 'bu',
    'cha', 'chan', 'nach', 'gum', 'gur', 'ag', 'a',
    'agus', 'ach', 'no', 'oir', 'ma', 'nuair', 'ged',
    'seo', 'sin', 'siud', 'eile', 'fhèin', 'cho', 'glè', 'ro', 'fìor',
    'cuideachd', 'fhathast', 'a-nis', 'an-diugh', 'an-dè', 'a-màireach',
    "'s", "b'", "d'",
}

# Inverse of the pack mutation map: lemma start → surface start.
LENITION = {
    'b': 'bh',
    'c': 'ch',
    'd': 'dh',
    'f': 'fh',
    'g': 'gh',
    'm': 'mh',
    'p': 'ph',
    's': 'sh',
    't': 'th',
}


@dataclass(frozen=True)
class Candidate:
    word: str
    rank: int
    forms: frozenset[str]


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
        default=PROJECT_ROOT / 'data' / 'dictionary-gd.db',
    )
    parser.add_argument(
        '--freq',
        type=Path,
        default=PROJECT_ROOT / 'scripts' / 'gd-wiki-freq.tsv',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-gd',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-gd.json',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def fold(text: str) -> str:
    return unicodedata.normalize('NFC', text).translate(APOSTROPHES).lower()


def mutated_forms(word: str) -> set[str]:
    forms = {word}
    if word[:2] in {"h-", "t-"}:
        return forms
    first = word[0]
    if first in LENITION:
        forms.add(LENITION[first] + word[1:])
    if word[0] in 'aeiouàèìòù':
        forms.add('h-' + word)
        forms.add('t-' + word)
    if word.startswith('s'):
        forms.add('t-' + word)
    return forms


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


def load_freq_ranks(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f'{path} is missing; run scripts/gen-gd-wiki-freq.py first')
    words: list[str] = []
    with path.open(encoding='utf-8', newline='') as source:
        for row in csv.DictReader(source, delimiter='\t'):
            words.append(fold(row['word']))
    return words


def load_lemma_map(connection: sqlite3.Connection) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for inflected, lemma in connection.execute('SELECT inflected_form, lemma FROM inflections'):
        if inflected and lemma and inflected not in mapping:
            mapping[fold(inflected)] = fold(lemma)
    return mapping


def build_candidates(dictionary_path: Path, freq_path: Path, max_words: int) -> list[Candidate]:
    if not dictionary_path.exists():
        raise FileNotFoundError(
            f'{dictionary_path} does not exist; run the Gaelic dictionary build first'
        )

    ranked = load_freq_ranks(freq_path)
    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        lemma_of = load_lemma_map(connection)
        for raw_word in ranked:
            word = fold(raw_word)
            lemma = lemma_of.get(word, word)
            if (
                word in seen
                or lemma in seen
                or word in AVOID_WORDS
                or lemma in AVOID_WORDS
                or len(word) < 2
                or not GAELIC_WORD.fullmatch(word)
            ):
                continue
            if not (
                useful_dictionary_word(connection, word)
                or useful_dictionary_word(connection, lemma)
            ):
                continue
            key = lemma if useful_dictionary_word(connection, lemma) else word
            forms = mutated_forms(key)
            forms.add(word)
            forms.add(key)
            seen.add(word)
            seen.add(key)
            candidates.append(
                Candidate(word=key, rank=len(candidates) + 1, forms=frozenset(forms))
            )
            if len(candidates) == max_words:
                break
    finally:
        connection.close()

    if len(candidates) < 200:
        raise RuntimeError(f'only found {len(candidates)} usable candidates (wanted at least 200)')
    print(f'Candidates: {len(candidates)} content words from the Wikipedia spine')
    return candidates


def load_sentences(path: Path) -> dict[int, str]:
    sentences: dict[int, str] = {}
    with path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            sentence_id = int(parts[0])
            text = unicodedata.normalize('NFC', parts[2].strip())
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
            source_id, english_id = int(parts[0]), int(parts[1])
            if source_id not in sentence_ids:
                continue
            links[source_id].append(english_id)
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
                sentences[sentence_id] = unicodedata.normalize('NFC', parts[2].strip())
    return sentences


def token_key(raw_token: str) -> str:
    start = 0
    end = len(raw_token)
    marks = set("'‘’ʼ`´ʹ")
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        if raw_token[start] in marks:
            break
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        if raw_token[end - 1] in marks:
            break
        end -= 1
    return fold(raw_token[start:end])


def sentence_matches(text: str, form_to_word: dict[str, str]) -> dict[str, tuple[str, int]]:
    matches: dict[str, tuple[str, int]] = {}
    for index, raw_token in enumerate(text.split()):
        part = token_key(raw_token)
        word = form_to_word.get(part)
        if word and word not in matches:
            matches[word] = (raw_token, index)
    return matches


def first_translation(english_ids: list[int], english: dict[int, str]) -> str | None:
    for sentence_id in english_ids:
        translation = english.get(sentence_id)
        if translation:
            return translation
    return None


def collect_options(
    gaelic: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    form_to_word: dict[str, str] = {}
    for candidate in candidates:
        for form in candidate.forms:
            form_to_word.setdefault(form, candidate.word)
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(gaelic):
        text = gaelic[sentence_id]
        if text in seen_texts:
            continue
        translation = first_translation(links.get(sentence_id, []), english)
        if not translation:
            continue
        matches = sentence_matches(text, form_to_word)
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

    print('=== Scottish Gaelic Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.freq, args.max_words)
    gaelic_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    gaelic = load_sentences(gaelic_path)
    links, needed_english = load_links(links_path, set(gaelic))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(gaelic)} length-filtered Gaelic sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    options = collect_options(gaelic, links, english, candidates)
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
