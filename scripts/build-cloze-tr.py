#!/usr/bin/env python3
"""Build the Turkish Tatoeba cloze bank used by the API.

The output is derived from Tatoeba's `tur` -> `eng` per-language exports
(CC BY 2.0 FR). Candidate words come from wordfreq, are restricted to useful
dictionary parts of speech, exclude proper names and common grammatical words,
and are densely ranked into the top500/top1000/top2000 practice bands. At most
six distinct sentences are retained per target word.

Two things differ from the other packs. Case folding is locale-aware, because
Turkish writes the dotted and dotless i as separate letters (I -> ı, İ -> i)
and `str.lower()` gets both wrong. And candidates are citation forms: Turkish
is agglutinative, so the dictionary records lemmas plus a large inflection
table rather than an entry per surface form, and a blank the learner can look
up is the bare word.

Prerequisites:
    pip install wordfreq
    npx tsx scripts/build-dictionary.ts --lang tr

Usage:
    python scripts/build-cloze-tr.py
    python scripts/build-cloze-tr.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/cloze-tr. Re-running with the same Tatoeba exports,
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
LANGUAGE_CODE = 'tur'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
# The 29-letter alphabet, lower case. q/w/x are not Turkish letters. Hyphenated
# compounds stay whole tokens at runtime and in sentence_matches below, so they
# can never collide with a plain candidate.
TURKISH_WORD = re.compile(r'^[abcçdefgğhıijklmnoöprsştuüvyz]+$')
APOSTROPHES = re.compile(r"['‘’ʼ`]+")

# Turkish case folding: I -> ı and İ -> i, which str.lower() does not do. Maps
# the two dotted/dotless pairs first, then lowercases the rest normally. This
# mirrors script.caseFoldLocale in languages/tr/manifest.ts and lowerForLang in
# scripts/build-dictionary.ts — all three must agree or a word keys twice.
TURKISH_LOWER = str.maketrans({'I': 'ı', 'İ': 'i'})

# Keep this aligned with languages/tr/manifest.ts. The POS filter removes most
# function words; this explicit list also catches surface forms that have a
# secondary noun/verb sense but still make poor cloze targets.
AVOID_WORDS = {
    # determiners and quantifiers
    'bir', 'birkaç', 'birçok', 'bazı', 'her', 'herhangi', 'hiçbir', 'tüm',
    'bütün', 'hep', 'hepsi', 'başka', 'diğer', 'öteki', 'aynı', 'tek', 'çok',
    'az', 'biraz', 'daha', 'en', 'fazla', 'kadar',
    # demonstratives and their case forms
    'bu', 'şu', 'o', 'bunu', 'şunu', 'onu', 'bunun', 'şunun', 'onun', 'buna',
    'şuna', 'ona', 'bunda', 'şunda', 'onda', 'bundan', 'şundan', 'ondan',
    'bunlar', 'şunlar', 'onlar', 'bunları', 'onları', 'bunların', 'onların',
    'böyle', 'şöyle', 'öyle', 'burada', 'şurada', 'orada', 'buraya', 'oraya',
    'buradan', 'oradan',
    # personal pronouns and their case forms
    'ben', 'sen', 'biz', 'siz', 'beni', 'seni', 'bizi', 'sizi', 'bana', 'sana',
    'bize', 'size', 'bende', 'sende', 'bizde', 'sizde', 'benden', 'senden',
    'bizden', 'sizden', 'benim', 'senin', 'bizim', 'sizin', 'kendi',
    'kendine', 'kendini', 'kendisi', 'herkes', 'kimse', 'biri', 'birisi',
    'birbirine',
    # question words and the separate question particle
    'ne', 'neden', 'niçin', 'niye', 'nasıl', 'kim', 'kimi', 'kime', 'kimin',
    'hangi', 'kaç', 'nerede', 'nereye', 'nereden', 'mi', 'mı', 'mu', 'mü',
    'miyim', 'misin', 'mısın', 'mısınız', 'misiniz',
    # conjunctions, postpositions and connectives
    've', 'ile', 'ya', 'veya', 'yahut', 'ama', 'fakat', 'ancak', 'lakin',
    'çünkü', 'ki', 'de', 'da', 'ise', 'yani', 'hem', 'hatta', 'ayrıca',
    'için', 'gibi', 'göre', 'sonra', 'önce', 'beri', 'doğru', 'karşı',
    'üzere', 'rağmen', 'dolayı', 'diye', 'eğer', 'oysa', 'halbuki', 'ayrı',
    'arasında', 'içinde', 'üzerine', 'yerine', 'hakkında', 'tarafından',
    'birlikte', 'boyunca',
    # particles, discourse markers and high-frequency adverbs
    'değil', 'var', 'yok', 'evet', 'hayır', 'peki', 'tabii', 'acaba', 'belki',
    'bile', 'sadece', 'yalnızca', 'işte', 'artık', 'yine', 'hemen', 'şimdi',
    'henüz', 'zaten', 'galiba', 'hiç', 'asla', 'şey',
    # the copula and olmak / etmek, which carry almost every predicate
    'olan', 'olarak', 'olur', 'oldu', 'olmak', 'olsun', 'olmaz', 'oluyor',
    'olacak', 'olduğu', 'olduğunu', 'olduğunda', 'olup', 'idi', 'imiş',
    'iken', 'etmek', 'eden', 'edilen',
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
        default=PROJECT_ROOT / 'data' / 'dictionary-tr.db',
        help='Turkish dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-tr',
        help='Tatoeba download/decompression cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-tr.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def normalize(text: str) -> str:
    return unicodedata.normalize('NFC', text)


def turkish_lower(text: str) -> str:
    return normalize(text.translate(TURKISH_LOWER).lower())


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
            f'{dictionary_path} does not exist; run the Turkish dictionary build first'
        )

    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        # Pull a generous frequency window because stop-word, POS and proper-name
        # filtering intentionally removes much of the head of the raw list, and
        # an agglutinative frequency list is mostly inflected forms that carry
        # no entry of their own.
        for raw_word in top_n_list('tr', max(max_words * 10, 20000)):
            word = turkish_lower(raw_word)
            if (
                word in seen
                or word in AVOID_WORDS
                or len(word) < 2
                or not TURKISH_WORD.fullmatch(word)
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
        raise RuntimeError(f'only found {len(candidates)} usable candidates (wanted {max_words})')
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
            turkish_id, english_id = int(parts[0]), int(parts[1])
            if turkish_id not in sentence_ids:
                continue
            links[turkish_id].append(english_id)
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


def token_parts(raw_token: str) -> list[str]:
    # Unicode punctuation/symbols at the outside are display-only. Apostrophes
    # inside the token are semantic boundaries in the runtime tokenizer, which
    # is what Turkish wants: a suffix on a proper noun is written İstanbul'da,
    # so the split leaves the lookupable noun on its own.
    start = 0
    end = len(raw_token)
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        end -= 1
    clean = turkish_lower(raw_token[start:end])
    return [part for part in APOSTROPHES.split(clean) if part]


def sentence_matches(text: str, candidate_words: set[str]) -> dict[str, tuple[str, int]]:
    matches: dict[str, tuple[str, int]] = {}
    for index, raw_token in enumerate(text.split()):
        for part in token_parts(raw_token):
            if part in candidate_words and part not in matches:
                matches[part] = (raw_token, index)
    return matches


def first_translation(english_ids: list[int], english: dict[int, str]) -> str | None:
    for sentence_id in english_ids:
        translation = english.get(sentence_id)
        if translation:
            return translation
    return None


def collect_options(
    turkish: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_words = {candidate.word for candidate in candidates}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(turkish):
        text = turkish[sentence_id]
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

    print('=== Turkish Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.max_words)
    turkish_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    turkish = load_sentences(turkish_path)
    links, needed_english = load_links(links_path, set(turkish))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(turkish)} length-filtered Turkish sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    options = collect_options(turkish, links, english, candidates)
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
