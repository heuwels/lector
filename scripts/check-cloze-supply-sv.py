#!/usr/bin/env python3
"""Count how many of the top 2000 Swedish wordfreq tokens fill from Tatoeba.

#474 gates the pack on this number. 41.6k swe↔eng pairs is half of Polish.
This check does not use the dictionary: it only asks whether the pair set
can supply sentences for frequent words.

    pip install wordfreq
    python scripts/check-cloze-supply-sv.py
"""
from __future__ import annotations

import bz2
import re
import shutil
import urllib.request
from collections import defaultdict
from pathlib import Path

from wordfreq import top_n_list

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE = PROJECT_ROOT / 'tmp' / 'cloze-sv'
TATOEBA = 'https://downloads.tatoeba.org/exports/per_language'
WORD = re.compile(r'^[a-zåäö-]+$')
MAX_WORDS = 2000
MIN_SENTENCE_WORDS = 4
MAX_SENTENCE_WORDS = 20

AVOID = {
    'en', 'ett', 'den', 'det', 'de', 'denna', 'detta', 'dessa',
    'jag', 'du', 'han', 'hon', 'vi', 'ni', 'man', 'sig', 'mig', 'dig',
    'oss', 'er', 'honom', 'henne', 'dem',
    'min', 'mitt', 'mina', 'din', 'ditt', 'dina', 'hans', 'hennes', 'dess',
    'vår', 'vårt', 'våra', 'ert', 'era', 'deras', 'sin', 'sitt', 'sina',
    'i', 'på', 'av', 'till', 'från', 'för', 'med', 'om', 'under', 'över',
    'efter', 'före', 'mellan', 'utan', 'mot', 'vid', 'hos', 'genom', 'åt',
    'och', 'eller', 'men', 'så', 'att', 'när', 'eftersom', 'medan', 'fast',
    'samt',
    'är', 'var', 'varit', 'vara', 'har', 'hade', 'ha', 'kan', 'kunde',
    'ska', 'skulle', 'vill', 'ville', 'måste', 'får', 'fick', 'blir',
    'blev', 'bli',
    'inte', 'ej', 'icke', 'ja', 'nej', 'jo',
    'vad', 'vem', 'vilken', 'vilket', 'vilka', 'vart', 'hur', 'varför',
    'också', 'även', 'bara', 'mycket', 'mer', 'mest', 'här', 'där', 'nu',
    'då', 'redan', 'ännu',
}


def download(name: str) -> Path:
    dest = CACHE / name
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    code = name.split('_', 1)[0].split('-', 1)[0]
    url = f'{TATOEBA}/{code}/{name}'
    print(f'downloading {url}')
    req = urllib.request.Request(url, headers={'User-Agent': 'lector-language-pack-builder/1.0'})
    partial = dest.with_suffix(dest.suffix + '.part')
    with urllib.request.urlopen(req) as response, partial.open('wb') as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    partial.replace(dest)
    return dest


def decompress(source: Path) -> Path:
    dest = source.with_suffix('')
    if dest.exists():
        return dest
    print(f'decompressing {source.name}')
    partial = dest.with_suffix(dest.suffix + '.part')
    with bz2.open(source, 'rb') as compressed, partial.open('wb') as out:
        shutil.copyfileobj(compressed, out, length=1024 * 1024)
    partial.replace(dest)
    return dest


def main() -> int:
    print('=== Swedish cloze sentence-supply check (#474) ===')
    candidates: list[str] = []
    seen: set[str] = set()
    for raw in top_n_list('sv', 10000):
        word = raw.lower()
        if word in seen or word in AVOID or len(word) < 2 or not WORD.fullmatch(word):
            continue
        seen.add(word)
        candidates.append(word)
        if len(candidates) == MAX_WORDS:
            break
    print(f'candidates: {len(candidates)} (wanted {MAX_WORDS})')

    swe_path = decompress(download('swe_sentences.tsv.bz2'))
    links_path = decompress(download('swe-eng_links.tsv.bz2'))

    sentences: dict[int, str] = {}
    with swe_path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t', 2)
            if len(parts) != 3:
                continue
            text = parts[2].strip()
            count = len(text.split())
            if MIN_SENTENCE_WORDS <= count <= MAX_SENTENCE_WORDS:
                sentences[int(parts[0])] = text
    linked: set[int] = set()
    with links_path.open(encoding='utf-8') as source:
        for line in source:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            sid = int(parts[0])
            if sid in sentences:
                linked.add(sid)
    print(f'Tatoeba: {len(sentences)} length-filtered; {len(linked)} linked to English')

    wanted = set(candidates)
    hits: dict[str, int] = defaultdict(int)
    for sid in linked:
        for token in sentences[sid].split():
            clean = re.sub(r'^[^\wåäöÅÄÖ-]+|[^\wåäöÅÄÖ-]+$', '', token).lower()
            if clean in wanted:
                hits[clean] += 1

    filled = sum(1 for word in candidates if hits[word] > 0)
    print(f'filled: {filled}/{len(candidates)} ({filled / len(candidates):.1%})')
    print(f'with ≥6 sentences: {sum(1 for word in candidates if hits[word] >= 6)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
