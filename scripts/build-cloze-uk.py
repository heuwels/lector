#!/usr/bin/env python3
"""Build the Ukrainian Tatoeba cloze bank used by the API.

The output is derived from Tatoeba's `ukr` -> `eng` per-language exports
(CC BY 2.0 FR). Candidate words come from wordfreq, are restricted to useful
dictionary parts of speech, exclude proper names and common grammatical words,
and are densely ranked into the top500/top1000/top2000 practice bands. At most
six distinct sentences are retained per target word.

This mirrors the Russian builder, with one deliberate difference: the
apostrophe. In Russian it is not orthography and the runtime tokenizer splits
on it, so the Russian builder splits too. In Ukrainian it is a letter-level part
of the word (зв'язку, п'ять), the tokenizer joins across it, and so does this
builder — a candidate word keeps its apostrophe, folded to ASCII ' the way
languages/uk/manifest.ts declares.

Prerequisites:
    pip install wordfreq
    npx tsx scripts/build-dictionary.ts --lang uk

Usage:
    python scripts/build-cloze-uk.py
    python scripts/build-cloze-uk.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/cloze-uk. Re-running with the same Tatoeba exports,
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
LANGUAGE_CODE = 'ukr'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
# The Ukrainian alphabet: а-щ is contiguous, then ь ю я; ъ ы э sit inside that
# span and are Russian-only, so a leaked Russian token fails the test. ґ є і ї
# are outside the range. An apostrophe is allowed BETWEEN letter runs, never at
# an edge — the same shape the runtime tokenizer's joiner produces. Hyphenated
# indefinites (будь-який, все-таки) stay whole tokens at runtime and in
# sentence_matches below, so they can never collide with a plain candidate;
# wordfreq emits unhyphenated tokens anyway.
LETTERS = 'а-щьюяґєії'
UKRAINIAN_WORD = re.compile(f"^[{LETTERS}]+(?:'[{LETTERS}]+)*$")
# Every variant a source can produce, folded to ASCII ' — mirrors
# languages/text.ts foldApostrophesFor and the uk pack's script.extraJoiners.
APOSTROPHES = re.compile(r"[‘’ʼʹ`´]")

# Keep this aligned with languages/uk/manifest.ts. The POS filter removes most
# function words; this explicit list also catches surface forms that have a
# secondary noun/verb sense but still make poor cloze targets.
AVOID_WORDS = {
    # prepositions
    'в', 'у', 'во', 'на', 'з', 'зі', 'із', 'до', 'від', 'од', 'за', 'під',
    'над', 'перед', 'після', 'про', 'для', 'без', 'через', 'між', 'біля',
    'коло', 'поза', 'крім', 'окрім', 'при', 'по', 'о', 'об', 'серед', 'проти',
    'щодо', 'заради', 'задля',
    # conjunctions and connectives
    'і', 'й', 'та', 'а', 'але', 'або', 'чи', 'що', 'щоб', 'щоби', 'якщо',
    'коли', 'поки', 'як', 'бо', 'тому', 'отже', 'також', 'теж', 'хоча',
    'адже', 'ніж',
    # particles
    'не', 'ні', 'ж', 'же', 'б', 'би', 'хай', 'нехай', 'ось', 'от', 'он', 'так',
    'вже', 'уже', 'ще', 'тільки', 'лише', 'лиш', 'дуже', 'навіть', 'аж',
    'хіба', 'наче', 'ніби', 'мов',
    # personal, reflexive and possessive pronouns (case forms)
    'я', 'ти', 'він', 'вона', 'воно', 'ми', 'ви', 'вони',
    'мене', 'мені', 'мною', 'тебе', 'тобі', 'тобою',
    'його', 'нього', 'йому', 'ньому', 'ним',
    'її', 'неї', 'їй', 'ній', 'нею',
    'нас', 'нам', 'нами', 'вас', 'вам', 'вами', 'їх', 'них', 'їм', 'ними',
    'себе', 'собі', 'собою',
    'мій', 'моя', 'моє', 'мої', 'твій', 'твоя', 'твоє', 'твої',
    'наш', 'наша', 'наше', 'наші', 'ваш', 'ваша', 'ваше', 'ваші',
    'свій', 'своя', 'своє', 'свої', 'їхній', 'їхня', 'їхнє', 'їхні',
    # demonstratives and interrogatives
    'цей', 'ця', 'це', 'ці', 'цього', 'цієї', 'цьому',
    'той', 'та', 'те', 'ті', 'того', 'тієї', 'тім',
    'хто', 'кого', 'кому', 'ким', 'чого', 'чому', 'чим',
    'який', 'яка', 'яке', 'які', 'чий', 'чия', 'чиє', 'чиї',
    'де', 'куди', 'звідки', 'навіщо', 'скільки',
    'весь', 'вся', 'все', 'всі', 'усе', 'усі', 'увесь', 'всіх', 'всім',
    # high-frequency forms of бути (to be)
    'бути', 'є', 'був', 'була', 'було', 'були', 'буде', 'будуть', 'буду',
    'будеш', 'будемо', 'будете',
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
        default=PROJECT_ROOT / 'data' / 'dictionary-uk.db',
        help='Ukrainian dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-uk',
        help='Tatoeba download/decompression cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-uk.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def normalize(text: str) -> str:
    return unicodedata.normalize('NFC', text)


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
            f'{dictionary_path} does not exist; run the Ukrainian dictionary build first'
        )

    candidates: list[Candidate] = []
    seen: set[str] = set()
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        # Pull a generous frequency window because stop-word, POS and proper-name
        # filtering intentionally removes much of the head of the raw list.
        for raw_word in top_n_list('uk', max(max_words * 5, 10000)):
            word = APOSTROPHES.sub("'", normalize(raw_word).lower())
            if (
                word in seen
                or word in AVOID_WORDS
                or len(word) < 2
                or not UKRAINIAN_WORD.fullmatch(word)
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
            ukrainian_id, english_id = int(parts[0]), int(parts[1])
            if ukrainian_id not in sentence_ids:
                continue
            links[ukrainian_id].append(english_id)
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
    # Unicode punctuation/symbols at the outside are display-only, and that
    # includes an apostrophe used as a quote — Ukrainian spelling never puts one
    # at a word edge. An apostrophe INSIDE the token is a letter, so the token
    # stays whole (the runtime tokenizer joins across it) and only the variant
    # spelling is folded away. This is the one place the Ukrainian builder
    # deliberately differs from the Russian one, which splits here.
    start = 0
    end = len(raw_token)
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        end -= 1
    clean = APOSTROPHES.sub("'", normalize(raw_token[start:end]).lower())
    return [clean] if clean else []


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
    ukrainian: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    candidate_words = {candidate.word for candidate in candidates}
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(ukrainian):
        text = ukrainian[sentence_id]
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

    print('=== Ukrainian Tatoeba cloze builder ===')
    candidates = build_candidates(args.dictionary, args.max_words)
    ukrainian_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)

    ukrainian = load_sentences(ukrainian_path)
    links, needed_english = load_links(links_path, set(ukrainian))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(ukrainian)} length-filtered Ukrainian sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    options = collect_options(ukrainian, links, english, candidates)
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
