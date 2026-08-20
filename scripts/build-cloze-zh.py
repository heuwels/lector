#!/usr/bin/env python3
"""Build the Mandarin Tatoeba cloze bank used by the API.

The output is derived from Tatoeba's `cmn` -> `eng` per-language exports
(CC BY 2.0 FR). Candidate words come from wordfreq, are restricted to useful
dictionary parts of speech, exclude proper names and common grammatical words,
and are densely ranked into the top500/top1000/top2000 practice bands. At most
six distinct sentences are retained per target word.

Chinese differs from every spaced pack in one way that matters, and it is the
reason this file exists rather than another entry in a shared script.

Mandarin has NO WORD SPACES, so `text.split()` cannot produce a token index. The
sentences are segmented with jieba, `clozeIndex` points into the jieba token
array, and the bank SHIPS THAT ARRAY as `tokens` (#289 4.3). Shipping it is not
optional: the client would otherwise re-segment with `Intl.Segmenter`, which
disagrees with jieba — jieba reads 这本书 as 这|本书 where ICU gives 这|本|书 —
and every stored index past the first disagreement would blank the wrong word.

Tatoeba's `cmn` corpus mixes Simplified and Traditional, about one row in five. The
pack declares `bcp47: 'zh-Hans'` and the dictionary keys on Simplified, so a
Traditional sentence is inconsistent with the rest of the pack even though it
resolves on tap through the headword alias. Those rows are dropped, detected with
OpenCC rather than a hand-written character list, so nothing leaks through.

Prerequisites:
    pip install wordfreq jieba opencc-python-reimplemented
    npx tsx scripts/build-dictionary.ts --lang zh

Usage:
    python scripts/build-cloze-zh.py
    python scripts/build-cloze-zh.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/cloze-zh. Re-running with the same Tatoeba exports,
wordfreq data, jieba version and dictionary produces the same bank.
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

import jieba
import opencc
from wordfreq import top_n_list


PROJECT_ROOT = Path(__file__).resolve().parent.parent
TATOEBA_DOWNLOADS = 'https://downloads.tatoeba.org/exports/per_language'
LANGUAGE_CODE = 'cmn'
ENGLISH_CODE = 'eng'
# Counted in jieba TOKENS, not whitespace runs. A Chinese sentence of eight
# tokens is about the same reading load as an eight-word Czech one.
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
# CJK Unified Ideographs + Extension A + the compatibility block, mirroring the
# zh dictionary profile's letterClass. A candidate must be Han throughout: the
# dump carries Latin headwords with real Mandarin readings (A -> ēi), but they
# make poor cloze targets and wordfreq ranks them by English usage.
HAN_WORD = re.compile(r'^[㐀-䶿一-鿿豈-﫿]+$')

# Keep this aligned with languages/zh/manifest.ts. Chinese has no articles and
# no inflection, so the function-word load is particles, pronouns, coverbs and
# measure words. The POS filter removes most of them; this explicit list also
# catches surface forms with a secondary noun/verb sense that still make poor
# cloze targets (有 as "to have", 用 as "to use").
AVOID_WORDS = {
    # structural and aspect particles
    '的', '了', '着', '过', '得', '地', '所', '之',
    # pronouns
    '我', '你', '您', '他', '她', '它', '我们', '你们', '他们', '她们', '自己',
    # demonstratives and interrogatives
    '这', '那', '这个', '那个', '这些', '那些', '什么', '谁', '哪', '哪个',
    '怎么', '为什么', '多少', '几',
    # coverbs and prepositions
    '在', '从', '到', '给', '对', '把', '被', '跟', '和', '与', '向', '为',
    '用', '于',
    # copula, existentials and common auxiliaries
    '是', '有', '没', '没有', '不', '会', '能', '可以', '要', '想', '就', '也',
    '都', '很', '还', '又', '再', '已经',
    # conjunctions and sentence-final particles
    '但', '但是', '因为', '所以', '如果', '而', '或', '吗', '呢', '吧', '啊',
    # the most common measure word
    '个',
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
    # The jieba segmentation of `text`. Ships with the row, because the client
    # cannot reproduce it (#289 4.3).
    tokens: tuple[str, ...]
    score: tuple[int, int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--dictionary',
        type=Path,
        default=PROJECT_ROOT / 'data' / 'dictionary-zh.db',
        help='Mandarin dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-zh',
        help='Tatoeba download/decompression cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-zh.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def normalize(text: str) -> str:
    return unicodedata.normalize('NFC', text)


# Traditional -> Simplified. Used only to DETECT, never to convert: converting
# would invent sentences no human wrote, and the one-to-many mappings
# (乾/幹/干 -> 干) make round-tripping lossy.
_TO_SIMPLIFIED = opencc.OpenCC('t2s')


def is_simplified(text: str) -> bool:
    """True when the text already carries no Traditional-only form.

    OpenCC rather than a character list, because a hand-written list is
    necessarily incomplete and the rows it misses are exactly the ones a reader
    would notice. If converting to Simplified changes nothing, there was nothing
    Traditional to change.
    """
    return _TO_SIMPLIFIED.convert(text) == text


def segment(text: str) -> list[str]:
    """The jieba token array for a sentence.

    `cut` yields every piece including punctuation and spaces, so joining the
    result reproduces the input. That is the contract the runtime relies on: the
    reader rejoins `tokens` to render the sentence, so a lossy split would
    change the displayed text.
    """
    return [token for token in jieba.cut(text, cut_all=False) if token]


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
            f'{dictionary_path} does not exist; run the Mandarin dictionary build first'
        )

    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        # Pull a generous frequency window because stop-word, POS and proper-name
        # filtering intentionally removes much of the head of the raw list.
        for raw_word in top_n_list('zh', max(max_words * 5, 10000)):
            word = normalize(raw_word)
            if (
                word in seen
                or word in AVOID_WORDS
                # Single characters are excluded for the same reason as every
                # other pack's len < 2 rule: a one-character answer is guessable
                # from the blank's width and teaches little. They stay in the
                # DICTIONARY, which is where a reader needs them.
                or len(word) < 2
                or not HAN_WORD.fullmatch(word)
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


def load_sentences(path: Path) -> tuple[dict[int, tuple[str, tuple[str, ...]]], int]:
    """Length-filtered SIMPLIFIED Mandarin sentences, each with its segmentation.

    Segmenting here rather than later means jieba runs once per sentence instead
    of once per candidate match. Traditional rows are dropped before segmentation,
    so jieba never runs on text that cannot ship.

    Returns the sentences and the number of Traditional rows dropped, so the
    build reports the cost of the filter rather than hiding it.
    """
    sentences: dict[int, tuple[str, tuple[str, ...]]] = {}
    dropped_traditional = 0
    with path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            sentence_id = int(parts[0])
            text = normalize(parts[2].strip())
            if not text:
                continue
            if not is_simplified(text):
                dropped_traditional += 1
                continue
            tokens = segment(text)
            # Count only word-like tokens: punctuation should not push a short
            # sentence over the length floor.
            word_count = sum(1 for token in tokens if HAN_WORD.fullmatch(token))
            if MIN_SENTENCE_WORDS <= word_count <= MAX_SENTENCE_WORDS:
                sentences[sentence_id] = (text, tuple(tokens))
    return sentences, dropped_traditional


def load_links(path: Path, sentence_ids: set[int]) -> tuple[dict[int, list[int]], set[int]]:
    links: dict[int, list[int]] = defaultdict(list)
    needed_english: set[int] = set()
    with path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            mandarin_id, english_id = int(parts[0]), int(parts[1])
            if mandarin_id not in sentence_ids:
                continue
            links[mandarin_id].append(english_id)
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


def sentence_matches(
    tokens: tuple[str, ...], candidate_words: set[str]
) -> dict[str, tuple[str, int]]:
    """Candidate words appearing as WHOLE jieba tokens, with their index.

    Whole tokens only, exactly as the spaced builders match whole whitespace
    tokens. A substring match would blank part of a word, and the runtime could
    never highlight it: `clozeIndex` addresses a token, not a character range.
    """
    matches: dict[str, tuple[str, int]] = {}
    for index, token in enumerate(tokens):
        if token in candidate_words and token not in matches:
            matches[token] = (token, index)
    return matches


def first_translation(english_ids: list[int], english: dict[int, str]) -> str | None:
    for sentence_id in english_ids:
        translation = english.get(sentence_id)
        if translation:
            return translation
    return None


def collect_options(
    mandarin: dict[int, tuple[str, tuple[str, ...]]],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_words = {candidate.word for candidate in candidates}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(mandarin):
        text, tokens = mandarin[sentence_id]
        if text in seen_texts:
            continue
        translation = first_translation(links.get(sentence_id, []), english)
        if not translation:
            continue
        matches = sentence_matches(tokens, candidate_words)
        if not matches:
            continue
        seen_texts.add(text)
        word_count = sum(1 for token in tokens if HAN_WORD.fullmatch(token))
        translation_words = len(translation.split())
        score = (abs(word_count - 8), abs(translation_words - 8), sentence_id)
        for word, (token, index) in matches.items():
            options[word].append(
                SentenceOption(
                    sentence_id=sentence_id,
                    text=text,
                    translation=translation,
                    cloze_word=token,
                    cloze_index=index,
                    tokens=tokens,
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
                    # Unspaced: the client cannot re-derive this (#289 4.3).
                    'tokens': list(option.tokens),
                    'wordRank': candidate.rank,
                    'collection': collection_for_rank(candidate.rank),
                }
            )
    return bank


def verify(bank: list[dict[str, object]]) -> None:
    """Fail the build rather than ship a bank the runtime cannot render.

    Three invariants:
      1. `tokens` rejoins to `text`. The reader renders the sentence by joining
         them, so a lossy segmentation changes what the learner sees.
      2. `tokens[clozeIndex]` is `clozeWord`. This is the whole point of the
         token index, and an off-by-one blanks the wrong word.
      3. Every row is Simplified. Checked again here rather than trusted from
         the load step, so a future change to the filter cannot let Traditional
         rows ship unnoticed.
    """
    for row in bank:
        text_value = row['text']
        assert isinstance(text_value, str)
        if not is_simplified(text_value):
            raise RuntimeError(f'row {row["id"]}: carries a Traditional form')
        tokens = row['tokens']
        assert isinstance(tokens, list)
        text = row['text']
        if ''.join(tokens) != text:
            raise RuntimeError(f'row {row["id"]}: tokens do not rejoin to the sentence')
        index = row['clozeIndex']
        assert isinstance(index, int)
        if not 0 <= index < len(tokens):
            raise RuntimeError(f'row {row["id"]}: clozeIndex {index} out of range')
        if tokens[index] != row['clozeWord']:
            raise RuntimeError(
                f'row {row["id"]}: tokens[{index}]={tokens[index]!r} '
                f'is not clozeWord={row["clozeWord"]!r}'
            )
    print(
        f'Verified {len(bank)} rows: all Simplified, tokens rejoin, '
        'and every blank lands on its clozeWord'
    )


def main() -> int:
    args = parse_args()
    if args.max_words < 1 or args.sentences_per_word < 1:
        raise ValueError('--max-words and --sentences-per-word must be positive')

    print('=== Mandarin Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.max_words)
    mandarin_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    mandarin, dropped_traditional = load_sentences(mandarin_path)
    links, needed_english = load_links(links_path, set(mandarin))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(mandarin)} length-filtered Simplified sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )
    print(f'  dropped {dropped_traditional} sentences carrying Traditional forms')

    options = collect_options(mandarin, links, english, candidates)
    bank = select_bank(candidates, options, args.sentences_per_word)
    verify(bank)

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
