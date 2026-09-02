#!/usr/bin/env python3
"""Count Scottish Gaelic tokens in the gdwiki pages-articles dump.

Scottish Gaelic has no wordfreq list. This script writes the frequency
spine that the coverage corpus and the cloze builder share.

    python scripts/gen-gd-wiki-freq.py

Downloads cache in tmp/gd-wiki. Re-running with the same dump is a no-op
for the download. The output is scripts/gd-wiki-freq.tsv.
"""

from __future__ import annotations

import bz2
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from xml.etree.ElementTree import iterparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DUMP_URL = 'https://dumps.wikimedia.org/gdwiki/latest/gdwiki-latest-pages-articles.xml.bz2'
CACHE_DIR = PROJECT_ROOT / 'tmp' / 'gd-wiki'
DUMP_PATH = CACHE_DIR / 'gdwiki-latest-pages-articles.xml.bz2'
OUT_PATH = PROJECT_ROOT / 'scripts' / 'gd-wiki-freq.tsv'

# Letters plus an internal apostrophe (a' bhean, d'fhàg). Hyphens stay in
# (an-diugh). Digits and markup stay out.
WORD = re.compile(r"[A-Za-zÀÈÌÒÙàèìòù]+(?:['’ʼ][A-Za-zÀÈÌÒÙàèìòù]+)*(?:-[A-Za-zÀÈÌÒÙàèìòù]+)*")
MARKUP = re.compile(
    r'\{\{.*?}}|\[\[(?:[^|\]]*\|)?([^\]]+)]]|<[^>]+>|\'{2,}|={2,}|^\*.*$|^#.*$',
    re.DOTALL | re.MULTILINE,
)
APOSTROPHES = str.maketrans({'’': "'", 'ʼ': "'", '‘': "'", '`': "'", '´': "'", 'ʹ': "'"})

# English and dump junk that ranks high on a small wiki.
SKIP = {
    'the', 'of', 'and', 'to', 'in', 'a', 'is', 'that', 'for', 'it', 'on',
    'with', 'as', 'was', 'be', 'by', 'at', 'this', 'from', 'or', 'an',
    'are', 'were', 'been', 'have', 'has', 'had', 'not', 'but', 'they',
    'their', 'which', 'can', 'will', 'would', 'about', 'into', 'also',
    'more', 'other', 'some', 'such', 'only', 'first', 'see', 'used',
    'use', 'may', 'these', 'two', 'than', 'its', 'over', 'after', 'new',
    'year', 'years', 'time', 'people', 'world', 'one', 'all', 'his',
    'her', 'he', 'she', 'we', 'you', 'my', 'your', 'our', 'http',
    'https', 'www', 'category', 'file', 'image', 'jpg', 'png', 'svg',
    'thumb', 'wiki', 'wikipedia', 'template', 'redirect', 'isbn',
    'defaultsort', 'ref', 'cite', 'web', 'com', 'org', 'html', 'nbsp',
    'align', 'style', 'left', 'right', 'center', 'width', 'height',
    'text-align', 'px', 'archive', 'end', 'uk', 'km', 'if', 'local',
    'then', 'args', 'roinn-seòrsa', 'bgcolor', 'colspan', 'rowspan',
    'class', 'href', 'src', 'alt', 'default', 'infobox', 'coord',
    'accessdate', 'publisher', 'location', 'pages', 'volume', 'issue',
    'oclc', 'doi', 'url', 'date', 'font-size', 'font-weight', 'br',
    'td', 'tr', 'th', 'div', 'span', 'table', 'small', 'big',
}

VOWELS = set('aeiouàèìòù')

NS_PREFIXES = (
    'category:',
    'file:',
    'image:',
    'template:',
    'talk:',
    'user:',
    'wikipedia:',
    'mediawiki:',
    'help:',
    'module:',
    'draft:',
    'roinn-seòrsa:',
    'faidhle:',
    'teamplaid:',
    'deasbaireachd:',
)


def fold(word: str) -> str:
    nfc = unicodedata.normalize('NFC', word).translate(APOSTROPHES).lower()
    return nfc


def download() -> None:
    if DUMP_PATH.exists():
        print(f'  cached: {DUMP_PATH.name}')
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f'  downloading {DUMP_URL}')
    request = urllib.request.Request(DUMP_URL, headers={'User-Agent': 'lector-language-pack-builder/1.0'})
    with urllib.request.urlopen(request) as response, DUMP_PATH.open('wb') as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    print(f'  wrote {DUMP_PATH.stat().st_size / 1024 / 1024:.1f} MB')


def skip_title(title: str | None) -> bool:
    if not title:
        return True
    lower = title.lower()
    return any(lower.startswith(prefix) for prefix in NS_PREFIXES)


def tokens_in(text: str) -> list[str]:
    clean = MARKUP.sub(lambda match: match.group(1) or ' ', text)
    return [fold(match.group(0)) for match in WORD.finditer(clean)]


def count_dump() -> Counter[str]:
    counts: Counter[str] = Counter()
    pages = 0
    with bz2.open(DUMP_PATH) as source:
        title = None
        for event, elem in iterparse(source, events=('end',)):
            tag = elem.tag.rsplit('}', 1)[-1]
            if tag == 'title':
                title = elem.text
            elif tag == 'text' and not skip_title(title) and elem.text:
                counts.update(
                    token
                    for token in tokens_in(elem.text)
                    if token not in SKIP
                    and len(token) >= 2
                    and any(ch in VOWELS for ch in token)
                )
                pages += 1
            if tag in {'title', 'text', 'page', 'revision'}:
                elem.clear()
    print(f'  pages: {pages}; tokens: {sum(counts.values()):,}; types: {len(counts):,}')
    return counts


def main() -> int:
    print('=== Scottish Gaelic Wikipedia frequency ===')
    download()
    counts = count_dump()
    rows = [(word, n) for word, n in counts.most_common() if n >= 2]
    OUT_PATH.write_text(
        'rank\tword\tcount\n'
        + '\n'.join(f'{i}\t{word}\t{n}' for i, (word, n) in enumerate(rows, start=1))
        + '\n',
        encoding='utf-8',
    )
    print(f'Wrote {len(rows)} types to {OUT_PATH}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        print(f'error: {error}', file=sys.stderr)
        raise SystemExit(1)
