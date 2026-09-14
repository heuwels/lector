"""Shared OSHB + Strong's loaders for the Biblical Hebrew pack (#255).

OSHB (Open Scriptures Hebrew Bible) is the Westminster Leningrad Codex with
per-word lemma and morphology, CC BY 4.0. Strong's Hebrew is public domain.
Both live at github.com/openscriptures. Downloads cache under tmp/.
"""

from __future__ import annotations

import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OSHB_CACHE = PROJECT_ROOT / 'tmp' / 'oshb'
STRONGS_URL = (
    'https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/HebrewStrong.xml'
)
OSHB_RAW = 'https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc'

# Cantillation (te'amim) only. Cloze display keeps niqqud.
CANTILLATION = re.compile(r'[\u0591-\u05AF]')
# Same mark set as foldHebrewKey in languages/text.ts.
HEBREW_MARKS = re.compile(r'[\u0591-\u05C7]')
HEBREW_LETTERS = re.compile(r'^[\u05D0-\u05EA]+$')
W_RE = re.compile(r'<w\s+([^>]*)>(.*?)</w>', re.DOTALL)
ATTR_RE = re.compile(r'(\w+)="([^"]*)"')
VERSE_RE = re.compile(
    r'<verse\s+[^>]*osisID="([A-Za-z0-9]+)\.(\d+)\.(\d+)"[^>]*>(.*?)</verse>',
    re.DOTALL,
)
ENTRY_RE = re.compile(r'<entry\s+id="H(\d+)">(.*?)</entry>', re.DOTALL)
STRONG_W_RE = re.compile(r'<w\s+([^>]*)>(.*?)</w>', re.DOTALL)
USAGE_RE = re.compile(r'<usage>(.*?)</usage>', re.DOTALL)
DEF_RE = re.compile(r'<def>(.*?)</def>')
TAG_RE = re.compile(r'<[^>]+>')

# (OSHB file, book number, WEB VPL code, display name)
BOOKS = [
    ('Gen', 1, 'GEN', 'Genesis'),
    ('Exod', 2, 'EXO', 'Exodus'),
    ('Lev', 3, 'LEV', 'Leviticus'),
    ('Num', 4, 'NUM', 'Numbers'),
    ('Deut', 5, 'DEU', 'Deuteronomy'),
    ('Josh', 6, 'JOS', 'Joshua'),
    ('Judg', 7, 'JDG', 'Judges'),
    ('Ruth', 8, 'RUT', 'Ruth'),
    ('1Sam', 9, '1SA', '1 Samuel'),
    ('2Sam', 10, '2SA', '2 Samuel'),
    ('1Kgs', 11, '1KI', '1 Kings'),
    ('2Kgs', 12, '2KI', '2 Kings'),
    ('1Chr', 13, '1CH', '1 Chronicles'),
    ('2Chr', 14, '2CH', '2 Chronicles'),
    ('Ezra', 15, 'EZR', 'Ezra'),
    ('Neh', 16, 'NEH', 'Nehemiah'),
    ('Esth', 17, 'EST', 'Esther'),
    ('Job', 18, 'JOB', 'Job'),
    ('Ps', 19, 'PSA', 'Psalms'),
    ('Prov', 20, 'PRO', 'Proverbs'),
    ('Eccl', 21, 'ECC', 'Ecclesiastes'),
    ('Song', 22, 'SNG', 'Song of Solomon'),
    ('Isa', 23, 'ISA', 'Isaiah'),
    ('Jer', 24, 'JER', 'Jeremiah'),
    ('Lam', 25, 'LAM', 'Lamentations'),
    ('Ezek', 26, 'EZE', 'Ezekiel'),
    ('Dan', 27, 'DAN', 'Daniel'),
    ('Hos', 28, 'HOS', 'Hosea'),
    ('Joel', 29, 'JOL', 'Joel'),
    ('Amos', 30, 'AMO', 'Amos'),
    ('Obad', 31, 'OBA', 'Obadiah'),
    ('Jonah', 32, 'JON', 'Jonah'),
    ('Mic', 33, 'MIC', 'Micah'),
    ('Nah', 34, 'NAM', 'Nahum'),
    ('Hab', 35, 'HAB', 'Habakkuk'),
    ('Zeph', 36, 'ZEP', 'Zephaniah'),
    ('Hag', 37, 'HAG', 'Haggai'),
    ('Zech', 38, 'ZEC', 'Zechariah'),
    ('Mal', 39, 'MAL', 'Malachi'),
]

POS_FROM_STRONG = {
    'v': 'verb',
    'n': 'noun',
    'a': 'adj',
    'adv': 'adv',
    'prep': 'prep',
    'conj': 'conj',
    'pron': 'pron',
    'inj': 'intj',
    'x': 'particle',
}


@dataclass(frozen=True)
class Token:
    text: str  # pointed, slashes gone, cantillation gone
    lemma: str  # unpointed Strong's headword
    strong: str  # "7225" or "1254"
    pos: str  # noun / verb / name / …


@dataclass(frozen=True)
class StrongEntry:
    lemma: str
    gloss: str
    pos: str


def fold_hebrew_key(text: str) -> str:
    """Drop niqqud and cantillation. Mirrors languages/text.ts foldHebrewKey."""
    return HEBREW_MARKS.sub('', unicodedata.normalize('NFC', text))


def strip_cantillation(text: str) -> str:
    return CANTILLATION.sub('', unicodedata.normalize('NFC', text))


def fetch(url: str, destination: Path) -> Path:
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f'  downloading {url}')
    request = urllib.request.Request(url, headers={'User-Agent': 'lector-language-pack-builder/1.0'})
    with urllib.request.urlopen(request) as response, destination.open('wb') as out:
        out.write(response.read())
    return destination


def _attrs(raw: str) -> dict[str, str]:
    return {key: value for key, value in ATTR_RE.findall(raw)}


def _stem_strong(lemma: str) -> str:
    stem = lemma.split('/')[-1].strip()
    return stem.split()[0] if stem else ''


def _strong_pos(pos_attr: str, xml_lang: str) -> str:
    if xml_lang == 'x-pn' or pos_attr.startswith('n-pr') or pos_attr.startswith('a-pr'):
        return 'name'
    head = pos_attr.split()[0] if pos_attr else ''
    if head.startswith('n-pr'):
        return 'name'
    if head.startswith('n'):
        return 'noun'
    return POS_FROM_STRONG.get(head, '')


def _clean_gloss(usage: str, defs: list[str]) -> str:
    if usage:
        text = TAG_RE.sub('', usage)
        text = re.sub(r'\s+', ' ', text).strip().rstrip('.')
        # Keep the first few renderings. Strong's usage lists can run long.
        parts = [part.strip() for part in text.split(',') if part.strip()]
        return ', '.join(parts[:4])
    if defs:
        return defs[0].strip()
    return ''


def load_strongs() -> dict[str, StrongEntry]:
    path = fetch(STRONGS_URL, PROJECT_ROOT / 'tmp' / 'HebrewStrong.xml')
    xml = path.read_text(encoding='utf-8')
    entries: dict[str, StrongEntry] = {}
    for number, body in ENTRY_RE.findall(xml):
        word_match = STRONG_W_RE.search(body)
        if not word_match:
            continue
        attrs = _attrs(word_match.group(1))
        headword = TAG_RE.sub('', word_match.group(2)).strip()
        lemma = fold_hebrew_key(headword.replace('/', ''))
        if not lemma or not HEBREW_LETTERS.fullmatch(lemma):
            continue
        usage_match = USAGE_RE.search(body)
        usage = usage_match.group(1) if usage_match else ''
        defs = DEF_RE.findall(body)
        entries[number] = StrongEntry(
            lemma=lemma,
            gloss=_clean_gloss(usage, defs),
            pos=_strong_pos(attrs.get('pos', ''), attrs.get('xml:lang', '')),
        )
    return entries


def _morph_pos(morph: str, strong_pos: str) -> str:
    stem = morph.split('/')[-1]
    if stem.startswith('H'):
        stem = stem[1:]
    if stem.startswith('Np') or 'Np' in morph.split('/')[-1]:
        return 'name'
    if stem.startswith('V'):
        return 'verb'
    if stem.startswith('N'):
        return 'noun'
    if stem.startswith('A'):
        return 'adj'
    if stem.startswith('D'):
        return 'adv'
    return strong_pos


def _parse_verse_tokens(inner: str, strongs: dict[str, StrongEntry]) -> list[Token]:
    tokens: list[Token] = []
    for attr_raw, body in W_RE.findall(inner):
        attrs = _attrs(attr_raw)
        lemma_attr = attrs.get('lemma', '')
        morph = attrs.get('morph', '')
        number = _stem_strong(lemma_attr)
        strong = strongs.get(number)
        surface = strip_cantillation(body.replace('/', '').replace('\n', ''))
        surface = re.sub(r'\s+', '', surface)
        if not surface:
            continue
        lemma = strong.lemma if strong else fold_hebrew_key(surface)
        pos = _morph_pos(morph, strong.pos if strong else '')
        tokens.append(Token(text=surface, lemma=lemma, strong=number, pos=pos))
    return tokens


def load_oshb(
    strongs: dict[str, StrongEntry],
) -> tuple[
    dict[tuple[int, int, int], list[Token]],
    Counter[str],
    dict[str, Counter[str]],
    dict[str, Counter[str]],
]:
    """Verse tokens, lemma counts, POS counts, and Strong's-id counts."""
    verses: dict[tuple[int, int, int], list[Token]] = {}
    lemma_counts: Counter[str] = Counter()
    lemma_pos: dict[str, Counter[str]] = defaultdict(Counter)
    lemma_strong: dict[str, Counter[str]] = defaultdict(Counter)
    book_numbers = {name: number for name, number, _web, _display in BOOKS}

    for file_name, book_number, _web, _display in BOOKS:
        path = fetch(f'{OSHB_RAW}/{file_name}.xml', OSHB_CACHE / f'{file_name}.xml')
        xml = path.read_text(encoding='utf-8')
        for osis_book, chapter, verse, inner in VERSE_RE.findall(xml):
            number = book_numbers.get(osis_book, book_number)
            tokens = _parse_verse_tokens(inner, strongs)
            if not tokens:
                continue
            verses[(number, int(chapter), int(verse))] = tokens
            for token in tokens:
                if not HEBREW_LETTERS.fullmatch(token.lemma):
                    continue
                lemma_counts[token.lemma] += 1
                if token.pos:
                    lemma_pos[token.lemma][token.pos] += 1
                if token.strong:
                    lemma_strong[token.lemma][token.strong] += 1
    return verses, lemma_counts, lemma_pos, lemma_strong


def surface_counts(verses: dict[tuple[int, int, int], list[Token]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for tokens in verses.values():
        for token in tokens:
            folded = fold_hebrew_key(token.text)
            if HEBREW_LETTERS.fullmatch(folded):
                counts[folded] += 1
    return counts
