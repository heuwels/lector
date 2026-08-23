#!/usr/bin/env python3
"""Build the Latin Tatoeba cloze bank used by the API (#256).

Tatoeba `lat` has a usable bank (~56k sentences), so this follows the
standard cloze path. Frequency has no wordfreq list: DCC Core Vocabulary
ranks seed the first ~1,000 lemmas, and Tatoeba token counts fill the rest.

Prerequisites:
    npx tsx scripts/build-dictionary.ts --lang la
    python scripts/gen-coverage-corpus-la.py   # writes dcc-latin-core.tsv

Usage:
    python scripts/build-cloze-la.py
    python scripts/build-cloze-la.py --max-words 2000 --sentences-per-word 6

Downloads are cached in tmp/cloze-la. Re-running with the same Tatoeba
exports, DCC ranks and dictionary produces the same bank.
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
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TATOEBA_DOWNLOADS = 'https://downloads.tatoeba.org/exports/per_language'
LANGUAGE_CODE = 'lat'
ENGLISH_CODE = 'eng'
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20
MAX_OPTIONS_PER_WORD = 80
CONTENT_PARTS_OF_SPEECH = {'adj', 'adv', 'intj', 'noun', 'num', 'verb'}
LATIN_WORD = re.compile(r'^[a-z]+$')
APOSTROPHES = re.compile(r"['‘’ʼ`]+")
MACRON_BREVE = {'\u0304', '\u0306'}

# Keep this aligned with languages/la/manifest.ts.
AVOID_WORDS = {
    'a', 'ab', 'ad', 'ante', 'apud', 'circum', 'contra', 'cum', 'de', 'e',
    'ex', 'extra', 'in', 'inter', 'intra', 'ob', 'per', 'post', 'prae', 'pro',
    'sine', 'sub', 'super', 'trans',
    'ac', 'atque', 'aut', 'autem', 'enim', 'ergo', 'et', 'igitur', 'nam',
    'nec', 'neque', 'nisi', 'quam', 'quia', 'quod', 'que', 'sed', 'si',
    'tamen', 'ut', 'vel', 'vero',
    'ego', 'mei', 'mihi', 'me', 'tu', 'tui', 'tibi', 'te', 'nos', 'nobis',
    'vos', 'vobis', 'se', 'sibi', 'sui',
    'hic', 'haec', 'hoc', 'ille', 'illa', 'illud', 'is', 'ea', 'id', 'eius',
    'ei', 'eum', 'eam', 'eorum', 'eis', 'eos', 'eas', 'iste', 'ipse',
    'qui', 'quae', 'quem', 'quo', 'quis', 'quid',
    'meus', 'tuus', 'suus', 'noster', 'vester',
    'sum', 'es', 'est', 'sumus', 'estis', 'sunt', 'eram', 'erat', 'erant',
    'ero', 'erit', 'esse', 'fui', 'fuit',
    'non', 'haud', 'ne', 'iam', 'nunc', 'tunc', 'tum', 'etiam', 'quoque',
    'sic', 'ita',
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
        default=PROJECT_ROOT / 'data' / 'dictionary-la.db',
        help='Latin dictionary database built by scripts/build-dictionary.ts',
    )
    parser.add_argument(
        '--dcc',
        type=Path,
        default=PROJECT_ROOT / 'scripts' / 'dcc-latin-core.tsv',
        help='Folded DCC lemma + rank TSV from gen-coverage-corpus-la.py',
    )
    parser.add_argument(
        '--cache-dir',
        type=Path,
        default=PROJECT_ROOT / 'tmp' / 'cloze-la',
        help='Tatoeba download/decompression cache',
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=PROJECT_ROOT / 'api' / 'src' / 'lib' / 'sentence-bank-la.json',
        help='Generated API sentence bank',
    )
    parser.add_argument('--max-words', type=int, default=2000)
    parser.add_argument('--sentences-per-word', type=int, default=6)
    return parser.parse_args()


def fold_latin(text: str) -> str:
    nfd = unicodedata.normalize('NFD', text.lower())
    stripped = ''.join(ch for ch in nfd if ch not in MACRON_BREVE)
    return unicodedata.normalize('NFC', stripped).replace('æ', 'ae').replace('œ', 'oe')


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


def load_dcc_ranks(path: Path) -> dict[str, int]:
    if not path.exists():
        raise FileNotFoundError(f'{path} does not exist; run gen-coverage-corpus-la.py first')
    ranks: dict[str, int] = {}
    with path.open(encoding='utf-8') as source:
        reader = csv.DictReader(source, delimiter='\t')
        for row in reader:
            lemma = fold_latin(row['lemma'])
            rank = int(row['rank'])
            prev = ranks.get(lemma)
            if prev is None or rank < prev:
                ranks[lemma] = rank
    return ranks


def load_lemma_map(connection: sqlite3.Connection) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for inflected, lemma in connection.execute('SELECT inflected_form, lemma FROM inflections'):
        if inflected and lemma and inflected not in mapping:
            mapping[inflected] = lemma
    return mapping


def count_tokens(sentences: dict[int, str]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for text in sentences.values():
        for raw in text.split():
            for part in token_parts(raw):
                if LATIN_WORD.fullmatch(part):
                    counts[part] += 1
    return counts


def build_candidates(
    dictionary_path: Path,
    dcc_path: Path,
    token_counts: Counter[str],
    max_words: int,
) -> list[Candidate]:
    if not dictionary_path.exists():
        raise FileNotFoundError(
            f'{dictionary_path} does not exist; run the Latin dictionary build first'
        )

    dcc_ranks = load_dcc_ranks(dcc_path)
    connection = sqlite3.connect(f'file:{dictionary_path}?mode=ro', uri=True)
    try:
        lemma_of = load_lemma_map(connection)

        # One candidate per lemma. Inflected forms of omnis/possum would
        # otherwise fill the top bands and hide the DCC spine.
        forms_by_lemma: dict[str, dict[str, int]] = defaultdict(dict)
        for word, count in token_counts.items():
            lemma = lemma_of.get(word, word)
            if (
                word in AVOID_WORDS
                or lemma in AVOID_WORDS
                or len(word) < 2
                or not LATIN_WORD.fullmatch(word)
            ):
                continue
            if not (
                useful_dictionary_word(connection, word)
                or useful_dictionary_word(connection, lemma)
            ):
                continue
            forms_by_lemma[lemma][word] = count

        scored: list[tuple[int, int, int, str, frozenset[str]]] = []
        for lemma, forms in forms_by_lemma.items():
            total = sum(forms.values())
            best_word = max(forms, key=lambda item: forms[item])
            dcc = dcc_ranks.get(lemma) or dcc_ranks.get(best_word)
            # DCC lemmas come first (their published rank). Other content
            # words follow in Tatoeba-frequency order.
            if dcc is not None:
                scored.append((0, dcc, -total, best_word, frozenset(forms)))
            else:
                scored.append((1, -total, 0, best_word, frozenset(forms)))
    finally:
        connection.close()

    scored.sort()
    candidates = [
        Candidate(word=word, rank=index + 1, forms=forms)
        for index, (*_, word, forms) in enumerate(scored[:max_words])
    ]
    if len(candidates) < max_words:
        raise RuntimeError(f'only found {len(candidates)} usable candidates (wanted {max_words})')
    print(f'Candidates: {len(candidates)} lemmas (DCC spine + Tatoeba counts)')
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


def token_parts(raw_token: str) -> list[str]:
    start = 0
    end = len(raw_token)
    while start < end and unicodedata.category(raw_token[start])[0] in {'P', 'S'}:
        start += 1
    while end > start and unicodedata.category(raw_token[end - 1])[0] in {'P', 'S'}:
        end -= 1
    clean = fold_latin(raw_token[start:end])
    return [part for part in APOSTROPHES.split(clean) if part]


def sentence_matches(
    text: str,
    form_to_word: dict[str, str],
) -> dict[str, tuple[str, int]]:
    matches: dict[str, tuple[str, int]] = {}
    for index, raw_token in enumerate(text.split()):
        for part in token_parts(raw_token):
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
    latin: dict[int, str],
    links: dict[int, list[int]],
    english: dict[int, str],
    candidates: list[Candidate],
) -> dict[str, list[SentenceOption]]:
    form_to_word: dict[str, str] = {}
    for candidate in candidates:
        for form in candidate.forms:
            form_to_word[form] = candidate.word
    options: dict[str, list[SentenceOption]] = defaultdict(list)
    seen_texts: set[str] = set()

    for sentence_id in sorted(latin):
        text = latin[sentence_id]
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
        options[word] = sorted(options[word], key=lambda option: option.score)[:MAX_OPTIONS_PER_WORD]
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

    print('=== Latin Tatoeba cloze builder ===')
    latin_path, links_path, english_path = ensure_tatoeba_files(args.cache_dir)
    latin = load_sentences(latin_path)
    links, needed_english = load_links(links_path, set(latin))
    english = load_english(english_path, needed_english)
    print(
        f'Tatoeba: {len(latin)} length-filtered Latin sentences; '
        f'{len(links)} linked; {len(english)} English translations'
    )

    candidates = build_candidates(args.dictionary, args.dcc, count_tokens(latin), args.max_words)
    options = collect_options(latin, links, english, candidates)
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
