#!/usr/bin/env python3
"""Generate the Traditional-to-Simplified map the zh dictionary build keys on.

    pip install opencc-python-reimplemented
    python scripts/gen-zh-t2s-map.py

Writes scripts/zh-t2s-map.json, read by `build-dictionary.ts --lang zh`.

Why this file exists
--------------------
The zh dictionary is keyed on the Simplified form, because that is what a
learner of Mandarin reads. kaikki's headwords are Traditional, so the build has
to convert. It used to take the conversion from kaikki's own `forms` table, by
picking the first row tagged `Simplified-Chinese`. That is wrong twice over:

1. A form row tagged `['alternative', 'Simplified-Chinese']` is the Simplified
   spelling of an ALTERNATIVE character, not of the headword. 今 lists 當/当 as
   an alternative form, so 今 claimed the key 当 and shipped `jīn` for it. 8,358
   keys were claimed this way, including 儿, 气, 业, 吗, 满, 码, 调 and 农.
2. The genuine row is often absent. 這, 當, 卻 and 參 carry no
   `Simplified-Chinese` row at all, so their Simplified keys had no honest
   claimant and were left to whichever alternative row arrived first.

OpenCC is the authority for the conversion, so the mapping comes from OpenCC
and not from the dump. It ships as a generated asset rather than a build-time
dependency: the dictionary build is TypeScript, the map is small and stable, and
a reviewer can read the diff.

Output shape
------------
    {"chars": {"這": "这", …}, "words": {"乾麵": "干面", …}}

`chars` is per character. `words` holds only the headwords where converting
character by character disagrees with OpenCC on the whole string, which happens
where OpenCC has a phrase rule (乾 alone is 干, but 乾麵 is 干面 while 乾隆 keeps
乾). The build applies `words` first and falls back to `chars`.

`words` is limited to the headwords of the cached dump, so the asset stays small
and every entry in it is one the build can actually use. Run
`build-dictionary.ts --lang zh` once first to populate tmp/kaikki-zh.jsonl.

The output carries no timestamp, so regenerating it against the same dump and
the same OpenCC version produces a byte-identical file.
"""
import json
import os
import sys

try:
    import opencc
except ImportError:
    sys.exit("opencc missing. Run: pip install opencc-python-reimplemented")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "zh-t2s-map.json")
DUMP = os.path.join(SCRIPT_DIR, "..", "tmp", "kaikki-zh.jsonl")

# CJK ranges worth converting: Unified Ideographs, Extension A, and the
# Compatibility block. Everything else in a headword (Latin, punctuation,
# bopomofo) passes through unchanged and needs no map entry.
CJK_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF))


def is_cjk(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in CJK_RANGES)


def main() -> None:
    if not os.path.exists(DUMP):
        sys.exit(f"missing {DUMP} — run build-dictionary.ts --lang zh once to cache the dump")

    convert = opencc.OpenCC("t2s").convert

    # Every CJK character that converts to something else.
    chars = {}
    for lo, hi in CJK_RANGES:
        for code in range(lo, hi + 1):
            ch = chr(code)
            simplified = convert(ch)
            # A one-character conversion must stay one character. OpenCC answers
            # a multi-character string for a handful of compatibility glyphs,
            # which is a spelling change rather than a key, so skip those.
            if simplified != ch and len(simplified) == 1:
                chars[ch] = simplified
    print(f"chars: {len(chars)} characters convert")

    def compose(word: str) -> str:
        return "".join(chars.get(ch, ch) for ch in word)

    # Headwords where the phrase rules disagree with per-character conversion.
    words = {}
    headwords = set()
    with open(DUMP, encoding="utf-8") as fh:
        for line in fh:
            try:
                word = json.loads(line).get("word")
            except ValueError:
                continue
            if word and any(is_cjk(ch) for ch in word):
                headwords.add(word)
    print(f"headwords: {len(headwords)} carry a CJK character")

    for word in headwords:
        whole = convert(word)
        if whole != compose(word) and len(whole) == len(word):
            words[word] = whole
    print(f"words: {len(words)} headwords need a phrase rule")

    payload = {
        "chars": dict(sorted(chars.items())),
        "words": dict(sorted(words.items())),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=0, sort_keys=True)
        fh.write("\n")
    size_kb = os.path.getsize(OUT) / 1024
    print(f"wrote {OUT} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
