# Starter content: the "First 1,000 Words" pipeline (#314 / #316)

How a language pack gets its default library content — the graded series seeded
into a user's library on first language selection (#315). The pipeline makes
"first 1,000 words" a **checkable claim**: every target word is provably
tappable, every lesson provably stays inside its frequency band.

```
1. wordlist   scripts/gen-starter-wordlist.py     → languages/<code>/content/starter/wordlist.json
2. draft      LLM + the recipe below              → languages/<code>/content/starter/NN-slug.md
3. verify     scripts/verify-starter-content.ts   → iterate on 2 until PASS
4. review     human read-through                  → does it read as prose, not constraint-satisfaction?
5. ship       manifest.json completes the pack    → #315 seeds it on first selection
```

## 1. Generate the target wordlist

```bash
# one-time: the wordfreq venv (repo convention: throwaway venv under tmp/)
python3 -m venv tmp/starter-venv && tmp/starter-venv/bin/pip install wordfreq

# wordfreq languages (es/de/fr/nl):
tmp/starter-venv/bin/python scripts/gen-starter-wordlist.py --lang es

# wordfreq-less languages (af today; eo will mirror this per #307) use the
# woordeboek Wikipedia+OpenSubtitles blend:
python3 scripts/gen-starter-wordlist.py --lang af \
    --freq-csv ../woordeboek/process/out/af-wiki-freq.csv --alias "n='n"
```

Needs `data/dictionary-<lang>.db` (fetch per `dict.env`). The list is the top N
frequency words **intersected with the dictionary** (exact headword or
inflection→lemma — the static half of `lookupWord`), minus proper nouns
(name-only entries + the CSV's `is_proper` flag) and letter-name entries.

Two semantics worth knowing:

- **Form-level, like the reader.** Resolution is exact-first, so very frequent
  inflected forms that have their own dictionary entries ("es", "está", "las")
  are their own wordlist targets. That mirrors exactly what a tap resolves to
  in the reader — the list is "the 1,000 most frequent *tappable word-keys*",
  not an abstract lemma inventory.
- **The wordlist is a committed artifact.** CI never runs the generator;
  regenerate deliberately (dictionary or frequency-source updates) and review
  the diff.

## 2. Draft lessons (the recipe)

Shape (from epic #314, as shipped for es in #317): 20 lessons × roughly
250–550 running words (the closing review lesson runs longer), four cumulative
bands (ranks 1–250 / 500 / 750 / 1000, five lessons each), up to ~60 new
target lemmas per lesson (`maxNewLemmas` relaxes single lessons — the opener
legitimately floods function words). Recycling (≥3 uses per introduced word)
is REPORTED by the verifier and worth maximizing, but v1 gates on coverage
only — full ≥3 recycling of 900+ words needs 3× the running text of a
20-lesson series. Connected mini-stories with recurring characters —
comprehensible-input prose, not vocabulary showcases.

Working LLM constraints for each lesson draft:

1. You may use ONLY: words whose dictionary resolution lands in the wordlist
   at rank ≤ this lesson's cap, plus the lesson's whitelisted proper nouns.
   (Careful with inflections: a conjugated form is fine when it *resolves* to
   an in-band target — "tengo" credits "tengo"/"tener" per the dictionary.)
2. Introduce at most ~50 wordlist targets not used in earlier lessons; lean on
   earlier vocabulary for everything else (that's the recycling).
3. 150–400 running words, markdown, `# Title` heading, short sentences early.
4. Continuity: recurring characters/places (whitelist their names in the
   manifest), each lesson continues the story.
5. Prefer high-frequency phrasings over idiomatic flourishes — if a word is
   out of band, say it another way.

Then run the verifier and feed its violations back into the next draft; repeat
until PASS. The violations are written to be actionable ("…is rank 411, beyond
this lesson's cap of 250").

A verified miniature lives in `scripts/starter/sample-es/` — two lessons that
PASS against the real es wordlist:

```bash
npx tsx scripts/verify-starter-content.ts --lang es \
    --dir scripts/starter/sample-es \
    --wordlist languages/es/content/starter/wordlist.json
```

## 3. Verify

```bash
npx tsx scripts/verify-starter-content.ts --lang es
# CI-grade bar for a shipped series (wired into ci.yml for every pack
# that ships a starter manifest):
npx tsx scripts/verify-starter-content.ts --lang es --require-coverage 90
```

Uses the app's own machinery — the shared tokenizer (`languages/tokenizer`),
`foldWord`, and the dictionary's exact+inflection resolution. Hard failures
(exit 1): **unresolvable** tokens (dead taps), **off-list** lemmas,
**out-of-band** lemmas, per-lesson **new-lemma caps**. Coverage (% of
reachable targets introduced) and under-recycled lemmas are always reported,
and enforced when the `--require-*` flags are given. The AI-cache fallthrough
of `lookupWord` deliberately does NOT count as resolution — starter content
must resolve for a brand-new user.

## 4. Manifest

`languages/<code>/content/starter/manifest.json` — the #315 seam fields plus
the verifier's optional knobs:

```jsonc
{
  "title": "Tus primeras 1000 palabras",
  "author": "Lector",
  "allow": ["Ana", "Toto"],              // series-wide whitelist (proper nouns)
  "maxNewLemmasPerLesson": 60,           // default 60
  "lessons": [
    { "file": "01-hola.md", "title": "Hola", "maxRank": 250, "allow": ["Madrid"] }
    // maxRank optional — defaults ramp by band (5 lessons per 250-band for 20 lessons)
  ]
}
```

Presence of `manifest.json` is what makes #315 seed the pack — a pack with
only `wordlist.json` seeds nothing.

## Per-language notes

- **es** — wordfreq; the only single-letter targets are y/a/o/e/u (letter-name
  entries are filtered by POS+gloss). The shipped series (#317) is written in
  "listed-form Spanish": the wordlist is form-level, so drafting can only use
  surface forms that resolve to listed keys — most 3rd-person conjugations and
  many feminine/plural forms have their own (unlisted) dictionary entries and
  are unavailable. First-person narration fits band 1 naturally; the verifier
  is the arbiter of what fits.
- **af** — no wordfreq; use the woordeboek blend CSV (`--freq-csv`) and
  `--alias "n='n"` (the CSV counts the article `'n` as bare `n`; the app
  tokenizes `'n` whole).
- **de/fr/nl** — wordfreq, same as es (rollout: #318).
- **future packs** — a language without wordfreq mirrors af's pipeline
  (see `woordeboek/process/FREQUENCY.md`); a language without a dictionary
  can't have starter content, by construction.
