#!/usr/bin/env python3
"""Generate the dominant Mandarin reading for every single-character headword.

    pip install pypinyin
    python scripts/gen-zh-readings.py

Writes scripts/zh-readings.json, read by `build-dictionary.ts --lang zh`.

Why this file exists
--------------------
A Han character carries several readings, and kaikki gives no way to rank them.
Worse, it splits them across records: the 的 page has one record whose Standard
Pinyin is `dì` and another for the particle `de`. The build merges the senses of
every record but keeps the FIRST reading it meets, so 的 shipped as `dì`. 的 is
the most frequent character in Chinese, so the reader printed a wrong reading
above it in almost every sentence.

An audit of the top 2,000 words by frequency found 20 characters answering with
the wrong reading. 都 gave `dū` for `dōu`, 还 gave `huán` for `hái`, 万 gave the
surname `mò` for `wàn`, and 听 gave the archaic `yǐn` for `tīng`.

pypinyin ranks readings by frequency, which is the judgement kaikki does not
carry, so the dominant reading comes from pypinyin.

Scope
-----
SINGLE CHARACTERS ONLY. Every one of the 20 errors was a single character.
A compound has one reading in kaikki and needs no ranking, and pypinyin would
apply its own segmentation to a compound, which is a worse answer than the
curated one. So the map covers what is broken and nothing more.

The map holds only characters that appear as a single-character headword in the
cached dump, so every entry is one the build can use. Run
`build-dictionary.ts --lang zh` once first to populate tmp/kaikki-zh.jsonl.

The output carries no timestamp, so a regeneration against the same dump and the
same pypinyin version produces a byte-identical file.
"""
import json
import os
import sys

try:
    from pypinyin import pinyin, Style
except ImportError:
    sys.exit("pypinyin missing. Run: pip install pypinyin")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "zh-readings.json")
DUMP = os.path.join(SCRIPT_DIR, "..", "tmp", "kaikki-zh.jsonl")

CJK_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF))


def is_cjk(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in CJK_RANGES)


def main() -> None:
    if not os.path.exists(DUMP):
        sys.exit(f"missing {DUMP} — run build-dictionary.ts --lang zh once to cache the dump")

    chars = set()
    with open(DUMP, encoding="utf-8") as fh:
        for line in fh:
            try:
                word = json.loads(line).get("word")
            except ValueError:
                continue
            if word and len(word) == 1 and is_cjk(word):
                chars.add(word)
    print(f"single-character headwords in the dump: {len(chars)}")

    readings = {}
    for ch in chars:
        got = pinyin(ch, style=Style.TONE, errors="ignore")
        if not got or not got[0]:
            continue
        value = got[0][0].strip()
        # A reading must be pinyin letters and tone marks, nothing else. A
        # character pypinyin does not know comes back as itself.
        if value and value != ch:
            readings[ch] = value
    print(f"characters with a dominant reading: {len(readings)}")

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(readings.items())), fh, ensure_ascii=False, indent=0, sort_keys=True)
        fh.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
