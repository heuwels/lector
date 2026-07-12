#!/usr/bin/env python3
"""Generate a language's starter-content target wordlist (#316).

Emits languages/<code>/content/starter/wordlist.json: the first N words of the
language by frequency, restricted to words the app can actually teach — every
entry must resolve in the language's on-device dictionary (exact headword or
inflection→lemma), because a starter word the reader can't define on tap is a
broken promise. Proper nouns are excluded (dictionary senses that are all
pos='name', plus the source's own NE flag when it has one).

Frequency sources (the two shapes in the repo):
  - wordfreq (es/de/fr/nl):    --lang es
        needs the wordfreq package; the repo convention is a throwaway venv:
        python3 -m venv tmp/starter-venv && tmp/starter-venv/bin/pip install wordfreq
  - blended CSV (af, and future wordfreq-less languages): --lang af --freq-csv
        woordeboek/process/out/af-wiki-freq.csv — the Wikipedia+OpenSubtitles
        blend (rank,word,count,zipf,cap_mid,proper_ratio,is_proper).

Surface forms are mapped to their dictionary LEMMA and deduped: "está" counts
toward "estar", ranked where its most frequent surface form first appears.
Output entries: {rank, lemma, zipf, band} with band = ceil(rank / band_size).

Usage:
  tmp/starter-venv/bin/python scripts/gen-starter-wordlist.py --lang es
  python3 scripts/gen-starter-wordlist.py --lang af \
      --freq-csv ../woordeboek/process/out/af-wiki-freq.csv

The wordlist is a committed artifact — CI never runs this script.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Mirrors languages/text.ts foldWord for the shipped (cased, Latin) languages:
# NFC + lowercase. Dictionary headwords are stored pre-folded.
def fold(word: str) -> str:
    return unicodedata.normalize("NFC", word).lower()


def is_wordlike(word: str) -> bool:
    """Letters only (plus internal hyphen/apostrophe) — drops digits, clitic
    fragments and punctuation artifacts that frequency lists carry. Single
    letters stay: y/a/o/e are real (and very frequent) Spanish words, af has
    'n — junk single letters are killed by dictionary resolution instead."""
    core = word.replace("-", "").replace("'", "")
    return len(core) > 0 and all(unicodedata.category(c).startswith("L") for c in core)


class Dictionary:
    def __init__(self, path: Path):
        if not path.exists():
            sys.exit(
                f"Dictionary not found: {path}\n"
                "Fetch it per dict.env, e.g.:\n"
                "  source ./dict.env && curl -fsSL \"https://github.com/heuwels/lector/"
                "releases/download/${DICT_VERSION_ES}/dictionary-es.db\" -o data/dictionary-es.db"
            )
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    ALT_SPELLING_MARKERS = (
        "alternative spelling of",
        "standard spelling of",  # de 'weiss' = "Switzerland and Liechtenstein standard spelling of weiß"
        "alternative form of",
        "obsolete spelling of",
    )

    def _inflection_lemma(self, folded: str) -> str | None:
        row = self.db.execute(
            "SELECT i.lemma FROM inflections i JOIN entries e ON e.word = i.lemma "
            "WHERE i.inflected_form = ? LIMIT 1",
            (folded,),
        ).fetchone()
        return row[0] if row else None

    def resolve_lemma(self, folded: str) -> str | None:
        """Exact headword, else inflection→lemma (the static half of the app's
        lookupWord path — the AI-cache fallthrough is deliberately absent:
        starter words must resolve for a brand-new user).

        One wordlist-specific refinement: an exact entry whose EVERY sense is
        an alternative-spelling note is not a teaching target — wordfreq's de
        list carries Swiss ss-spellings (weiss/gross/strasse) with their own
        kaikki entries, while real German content produces the ß keys. Follow
        the inflections link to the canonical headword instead, so the list
        holds the key the app tokenizer will actually credit."""
        row = self.db.execute("SELECT word FROM entries WHERE word = ?", (folded,)).fetchone()
        if row:
            word = row[0]
            senses = self.db.execute("SELECT gloss FROM senses WHERE word = ?", (word,)).fetchall()
            if senses and all(
                any(marker in s[0].lower() for marker in self.ALT_SPELLING_MARKERS) for s in senses
            ):
                canonical = self._inflection_lemma(folded)
                if canonical and canonical != word:
                    return canonical
            return word
        return self._inflection_lemma(folded)

    def is_name_only(self, headword: str) -> bool:
        pos = self.pos_set(headword)
        return len(pos) > 0 and pos <= {"name"}

    def pos_set(self, headword: str) -> set[str]:
        rows = self.db.execute("SELECT DISTINCT pos FROM senses WHERE word = ?", (headword,)).fetchall()
        return {r[0] for r in rows if r[0]}

    def is_function_single_letter(self, headword: str) -> bool:
        """Single-letter candidates are mostly letter-name entries (kaikki pos
        'character': b, q, x…) leaked from frequency lists. Keep only genuine
        one-letter function words — es y/a/o/e/u — i.e. a conj/prep/article/det
        sense whose gloss isn't itself an abbreviation/obsolete-spelling note
        (es 'd' = "abbreviation of de", 'i' = "obsolete spelling of y"), and no
        'name' sense. Conservative by design: if a language has a one-letter
        word outside these POS (e.g. fr 'y' pron), extend this or whitelist it
        in the pack manifest."""
        if "name" in self.pos_set(headword):
            return False
        junk = (
            "abbreviation of",
            "obsolete spelling of",
            "obsolete form of",
            "alternative spelling of",
            "nonstandard form of",  # de 'n' = "nonstandard form of 'n"
        )
        rows = self.db.execute(
            "SELECT gloss FROM senses WHERE word = ? AND pos IN ('conj','prep','article','det')",
            (headword,),
        ).fetchall()
        return any(not r[0].lower().startswith(junk) for r in rows)


def candidates_wordfreq(lang: str, scan: int):
    try:
        from wordfreq import top_n_list, zipf_frequency
    except ImportError:
        sys.exit(
            "wordfreq is not installed. Repo convention:\n"
            "  python3 -m venv tmp/starter-venv && tmp/starter-venv/bin/pip install wordfreq\n"
            "  tmp/starter-venv/bin/python scripts/gen-starter-wordlist.py --lang " + lang
        )
    for word in top_n_list(lang, scan):
        yield word, zipf_frequency(word, lang), False


def candidates_csv(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            is_proper = row.get("is_proper", "0").strip() in ("1", "true", "True")
            yield row["word"], float(row["zipf"]), is_proper


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", required=True, help="language code (must have data/dictionary-<lang>.db)")
    ap.add_argument("--top", type=int, default=1000, help="wordlist size (default 1000)")
    ap.add_argument("--band-size", type=int, default=250, help="lemmas per band (default 250)")
    ap.add_argument("--scan", type=int, default=30000, help="how deep to scan the frequency source")
    ap.add_argument("--freq-csv", type=Path, help="blended-frequency CSV (af); omit to use wordfreq")
    ap.add_argument("--dict", type=Path, help="dictionary db (default data/dictionary-<lang>.db)")
    ap.add_argument("--out", type=Path, help="output (default languages/<lang>/content/starter/wordlist.json)")
    ap.add_argument(
        "--alias",
        action="append",
        default=[],
        metavar="FROM=TO",
        help="rename a source token before resolution (repeatable). af: --alias \"n='n\" — "
        "the woordeboek CSV counts the article 'n as bare n, but the app tokenizes 'n whole.",
    )
    ap.add_argument(
        "--drop",
        action="append",
        default=[],
        metavar="WORD",
        help="explicitly exclude a candidate (repeatable) — the escape hatch for "
        "per-language judgment calls the generic filters can't make.",
    )
    args = ap.parse_args()

    aliases = dict(a.split("=", 1) for a in args.alias)
    drops = {fold(d) for d in args.drop}
    # Keys the tokenizer can actually produce: apostrophe-bearing keys are only
    # legal when deliberately aliased in (af "'n" has an extraTokenPattern);
    # otherwise the tokenizer SPLITS apostrophes (de "geht's" → geht + s), so
    # such a key could never be credited by real content — a wasted slot.
    alias_targets = {fold(v) for v in aliases.values()}

    dictionary = Dictionary(args.dict or REPO / "data" / f"dictionary-{args.lang}.db")
    source = candidates_csv(args.freq_csv) if args.freq_csv else candidates_wordfreq(args.lang, args.scan)

    words: list[dict] = []
    seen_lemmas: set[str] = set()
    stats = {"scanned": 0, "not_wordlike": 0, "flagged_proper": 0, "unresolvable": 0, "name_only": 0, "lemma_dupe": 0}

    for surface, zipf, flagged_proper in source:
        if len(words) >= args.top:
            break
        stats["scanned"] += 1
        folded = fold(aliases.get(surface, surface))
        if not is_wordlike(folded):
            stats["not_wordlike"] += 1
            continue
        if folded in drops:
            stats["dropped"] = stats.get("dropped", 0) + 1
            continue
        if flagged_proper:
            stats["flagged_proper"] += 1
            continue
        lemma = dictionary.resolve_lemma(folded)
        if lemma is None:
            stats["unresolvable"] += 1
            continue
        if lemma in seen_lemmas:
            stats["lemma_dupe"] += 1
            continue
        # The resolved KEY must be producible by the app tokenizer, which
        # splits apostrophes (de "geht's" → geht + s) — such a key could never
        # be credited by real content. Aliased keys (af "'n", which has its own
        # extraTokenPattern) are deliberate exceptions. Checked on the lemma,
        # not the surface: af CSV "video's" legitimately resolves to "video".
        if "'" in lemma and lemma not in alias_targets:
            stats["untokenizable"] = stats.get("untokenizable", 0) + 1
            continue
        if dictionary.is_name_only(lemma):
            stats["name_only"] += 1
            continue
        if len(lemma.replace("'", "")) == 1 and not dictionary.is_function_single_letter(lemma):
            stats["letter_name"] = stats.get("letter_name", 0) + 1
            continue
        seen_lemmas.add(lemma)
        rank = len(words) + 1
        words.append({
            "rank": rank,
            "lemma": lemma,
            "zipf": round(zipf, 2),
            "band": math.ceil(rank / args.band_size),
        })

    if len(words) < args.top:
        print(f"warning: only {len(words)}/{args.top} lemmas found — deepen --scan?", file=sys.stderr)

    out = args.out or REPO / "languages" / args.lang / "content" / "starter" / "wordlist.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "language": args.lang,
        "source": "csv" if args.freq_csv else "wordfreq",
        "bandSize": args.band_size,
        "count": len(words),
        "words": words,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"wrote {out} ({len(words)} lemmas)", file=sys.stderr)
    print(f"stats: {stats}", file=sys.stderr)


if __name__ == "__main__":
    main()
