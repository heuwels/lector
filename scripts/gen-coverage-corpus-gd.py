#!/usr/bin/env python3
"""Write the build-time coverage corpus for Scottish Gaelic.

    python scripts/gen-gd-wiki-freq.py
    python scripts/gen-coverage-corpus-gd.py

The dump is 2.5 million words, so a top-2000 list is stable and a top-5000
list is not. The gate uses 2000 tokens.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
FREQ = Path(__file__).resolve().parent / 'gd-wiki-freq.tsv'
OUT = Path(__file__).resolve().parent / 'coverage-corpus-gd.txt'

# English and dump tokens that survive the frequency skip list and then
# fail the dictionary gate. They are not Gaelic reading.
ENGLISH = {
    'gov', 'return', 'census', 'true', 'id', 'name', 'function', 'background',
    'nobel', 'title', 'distance', 'aspx', 'la', 'ipa', 'value', 'calculator',
    'john', 'national', 'text', 'en', 'population', 'nil', 'string', 'link',
    'frame', 'oxford', 'rel', 'wales', 'false', 'scotland', 'top', 'else',
    'statistics', 'set', 'co', 'ons', 'smo', 'caerdydd', 'html', 'http',
    'https', 'www', 'com', 'org', 'net', 'pdf', 'jpg', 'png', 'svg', 'gif',
    'css', 'js', 'json', 'xml', 'php', 'asp', 'htm', 'nbsp', 'amp', 'quot',
    'style', 'class', 'width', 'height', 'color', 'align', 'center', 'left',
    'right', 'size', 'font', 'bold', 'italic', 'image', 'file', 'thumb',
    'category', 'template', 'redirect', 'isbn', 'doi', 'oclc', 'pmid',
    'url', 'date', 'year', 'years', 'month', 'day', 'time', 'page', 'pages',
    'volume', 'issue', 'edition', 'publisher', 'location', 'accessdate',
    'website', 'retrieved', 'accessed', 'january', 'february', 'march',
    'april', 'june', 'july', 'august', 'september', 'october', 'november',
    'december', 'the', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'as',
    'by', 'from', 'at', 'or', 'an', 'is', 'was', 'were', 'be', 'been',
    'are', 'this', 'that', 'these', 'those', 'it', 'its', 'his', 'her',
    'their', 'they', 'them', 'he', 'she', 'we', 'you', 'not', 'but',
    'which', 'who', 'what', 'when', 'where', 'how', 'can', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'have', 'has', 'had',
    'also', 'more', 'most', 'other', 'some', 'any', 'all', 'each', 'every',
    'both', 'few', 'many', 'much', 'such', 'than', 'then', 'now', 'here',
    'there', 'about', 'into', 'over', 'after', 'before', 'between', 'under',
    'through', 'during', 'without', 'within', 'against', 'among', 'new',
    'old', 'first', 'last', 'next', 'same', 'own', 'other', 'another',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'see', 'used', 'use', 'using', 'made', 'make', 'known', 'called',
    'born', 'died', 'city', 'town', 'county', 'country', 'state', 'states',
    'united', 'kingdom', 'british', 'english', 'irish', 'welsh', 'scottish',
    'university', 'school', 'college', 'church', 'saint', 'king', 'queen',
    'sir', 'lord', 'lady', 'dr', 'mr', 'mrs', 'james', 'william', 'robert',
    'david', 'thomas', 'george', 'charles', 'mary', 'elizabeth', 'margaret',
    'london', 'edinburgh', 'glasgow', 'aberdeen', 'inverness', 'dublin',
    'cardiff', 'paris', 'berlin', 'rome', 'york', 'america', 'europe',
    'africa', 'asia', 'australia', 'canada', 'france', 'germany', 'italy',
    'spain', 'russia', 'china', 'india', 'japan', 'island', 'islands',
    'river', 'lake', 'mountain', 'north', 'south', 'east', 'west',
    'northern', 'southern', 'eastern', 'western', 'central', 'great',
    'greater', 'little', 'high', 'low', 'large', 'small', 'long', 'short',
    'area', 'number', 'part', 'group', 'member', 'people', 'person',
    'family', 'children', 'man', 'men', 'woman', 'women', 'life', 'work',
    'world', 'history', 'language', 'languages', 'name', 'names',
    'population', 'census', 'statistics', 'office', 'national', 'royal',
    'public', 'local', 'general', 'official', 'original', 'main',
    'reference', 'references', 'external', 'links', 'see', 'also',
    'infobox', 'coord', 'dmy', 'mdy', 'defaultsort', 'authority',
    'control', 'commons', 'wikidata', 'wiki', 'wikipedia', 'archive',
    'org', 'uk', 'gov', 'edu', 'ac', 'co', 'if', 'else', 'then', 'return',
    'true', 'false', 'null', 'none', 'undefined', 'function', 'var',
    'let', 'const', 'class', 'this', 'new', 'typeof', 'string', 'number',
    'boolean', 'object', 'array', 'value', 'values', 'key', 'keys',
    'type', 'types', 'id', 'ids', 'ref', 'refs', 'src', 'href', 'alt',
    'title', 'width', 'height', 'style', 'color', 'background', 'border',
    'margin', 'padding', 'display', 'float', 'clear', 'position',
    'absolute', 'relative', 'hidden', 'visible', 'none', 'block',
    'inline', 'table', 'row', 'cell', 'header', 'footer', 'body',
    'script', 'link', 'meta', 'image', 'img', 'div', 'span', 'br',
    'px', 'em', 'pt', 'cm', 'km', 'kg', 'lb', 'ft', 'in', 'mm',
    'args', 'argv', 'param', 'params', 'config', 'option', 'options',
    'default', 'index', 'count', 'total', 'sum', 'min', 'max', 'avg',
    'start', 'end', 'begin', 'stop', 'next', 'prev', 'previous',
    'first', 'last', 'item', 'items', 'list', 'lists', 'data',
    'info', 'information', 'content', 'contents', 'text', 'texts',
    'word', 'words', 'line', 'lines', 'file', 'files', 'path',
    'url', 'urls', 'http', 'https', 'ftp', 'www', 'html', 'htm',
    'xml', 'json', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'xls',
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'mp3', 'mp4',
    'calculator', 'distance', 'nobel', 'oxford', 'ipa', 'aspx',
    'frame', 'rel', 'smo', 'ons', 'nil', 'caerdydd', 'census',
    'statistics', 'population', 'national', 'scotland', 'wales',
    'john', 'james', 'william', 'robert', 'thomas', 'george',
    'th', 'mh', 'fh', 'dh', 'bh', 'gh', 'ph', 'sh', 'ch',
    'mongabay', 'enwau', 'lleoedd', 'bedwyr', 'e-gymraeg',
    'enwaucymru', 'chwilio', 'canolfan', 'parameter', 'parameters',
    'contae', 'label', 'press', 'match', 'result', 'distancecalculator',
    'globefeed', 'error', 'module', 'background-color', 'bar',
    'message', 'self', 'abertawe', 'jones', 'elseif', 'es',
    'hill', 'format', 'gaelic', 'colombia', 'qid', 'utilities',
    'talk', 'scope', 'mediawiki', 'wikitable', 'imdb', 'edit',
    'prefix', 'lang', 'action', 'news', 'dane', 'al', 'el', 'uhi',
}


def main() -> int:
    if not FREQ.exists():
        raise FileNotFoundError(f'{FREQ} is missing; run scripts/gen-gd-wiki-freq.py first')

    words: list[str] = []
    with FREQ.open(encoding='utf-8', newline='') as source:
        for row in csv.DictReader(source, delimiter='\t'):
            word = row['word']
            if len(word) < 2 or word in ENGLISH:
                continue
            if word.count('-') >= 2:
                continue
            if len(word) > 18 and not any(ch in 'àèìòù' for ch in word):
                continue
            words.append(word)
            if len(words) >= N:
                break

    OUT.write_text(
        '# Build-time coverage corpus for build-dictionary.ts --lang gd.\n'
        f'# Top-{N} tokens of the gd.wikipedia frequency list (gd has no\n'
        '# wordfreq). English, Welsh, and dump junk dropped. The dump is\n'
        '# 1.6 million tokens, so 1000 is the stable depth.\n'
        '# Regenerate: python scripts/gen-gd-wiki-freq.py\n'
        f'#          && python scripts/gen-coverage-corpus-gd.py {N}\n'
        + '\n'.join(words)
        + '\n',
        encoding='utf-8',
    )
    print(f'wrote {len(words)} words to {OUT}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as error:
        print(f'error: {error}', file=sys.stderr)
        raise SystemExit(1)
