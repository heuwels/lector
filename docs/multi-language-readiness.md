# Multi-language readiness audit

_Scan for hardcoded Afrikaans assumptions that bypass the active-language abstraction._

> **Status (this branch):** the **code de-hardcoding** items below are implemented —
> browser TTS, Tatoeba, and the dictionary path/lookup are now driven off the active
> language; the sentence-bank seeding mislabel bug is fixed; and the hardcoded
> "Afrikaans" UI copy now uses the active language name. Still open (deliberately out
> of scope here): the data-partitioning items (`dailyStats` Next routes, `collection_groups`)
> and all non-Afrikaans **content** (de/es dictionaries, per-language sentence banks).

## Verdict

**The data/wiring path is genuinely multi-language ready; the gaps are concentrated in (a) a handful of code paths that still hardcode `af`/`afr`/`af-ZA`, and (b) the absence of content for any language other than Afrikaans.**

Switching language already works end-to-end: `LanguageSelector` writes both the SQLite `targetLanguage` setting and the `lector-target-language` localStorage key, `SetupGuard` reconciles them on boot, `data-layer.ts` threads `?language=`/`language:` into nearly every request, and every Bun API route resolves it via `resolveLanguage()`. Cloze, vocab, known-words, journal and collections rows are all tagged with the language at write time, so the **core data model partitions by language**. (Two tables are exceptions — daily-activity stats and collection groups; see Known issues.)

**Single biggest blocker:** there is no content for de/es. The curated dictionary is a hardcoded `dictionary-af.db`, and the cloze **sentence bank is Afrikaans-only with no language field** — yet the seeder stamps each sentence with the *active* language, so seeding under German would fill the German deck with Afrikaans sentences mislabeled `de`. De-hardcoding the strings is the easy half; producing per-language dictionaries and sentence banks is the real work.

---

## Already done (the abstraction exists and is used)

| Area | Evidence |
|---|---|
| Language registry (af/de/es) with tts/tatoeba codes, avoid-words, test phrase | `src/lib/languages.ts`, `api/src/lib/languages.ts` |
| Active-language resolution (setting + per-request override) | `api/src/lib/active-language.ts`, `src/lib/server/active-language.ts` (`resolveLanguage`, `getActiveLanguageCode`) |
| Language switch persists to **both** stores | `LanguageSelector/index.tsx:37-38`, `setup/page.tsx:22-23` |
| Boot reconciliation (server setting → localStorage) | `SetupGuard/index.tsx:26-35` |
| Request threading (`?language=` / body `language`) | `data-layer.ts` `langParam()` (line 16-18), used on ~all calls |
| Bun routes all resolve language | `explain/cloze/stats/collections/chat/journal-correct/vocab/translate.ts` |
| LLM prompts use `${langName}`, spelreels gated by language | `api/src/routes/translate.ts:39-79` (`lang === 'af' ? getSpelreelsContext() : ''`) |
| Translate caller passes language explicitly | `src/lib/claude.ts:38,62` |
| Google/server TTS passes language | `src/lib/tts.ts:179` |

> Next.js `src/app/api/*` LLM routes (translate, explain, …) are **thin proxies** to the Bun server and forward the body verbatim — they don't need their own `resolveLanguage`, so their absence from the abstraction is expected, not a gap.

---

## Blockers — code (hardcoded `af` despite active language)

### 1. Browser TTS is Afrikaans-only
`src/lib/tts.ts` — the **Google/server TTS mode is language-aware** (passes `language` at line 179), but the **browser fallback mode is fully hardcoded**:
- `const AFRIKAANS_LANG = 'af-ZA'` (line 9), `FALLBACK_LANGS = ['af','nl-NL','nl']` (line 12)
- `scoreVoice` (line 85-86), `getAfrikaansVoice()`, candidate `allLangs` (line 123) all assume af/Dutch
- **Fix:** drive voice selection from `LANGUAGES[activeLang].ttsCode` + `.fallbackTts` (both already exist in the registry).

### 2. Tatoeba sentence fetch is hardcoded to Afrikaans
`src/app/api/tatoeba/route.ts:63` — `from: 'afr'`; the route never reads a language param.
- **Fix:** read `language`, use `LANGUAGES[lang].tatoebaCode` (registry already has `afr`/`deu`/`spa`).

### 3. Curated dictionary path is hardcoded
`src/lib/server/dictionary-db.ts:22` — `return path.join(dir, 'dictionary-af.db')`.
- **Fix:** `dictionary-${activeLang}.db`. (This is also a content blocker — see below.)

---

## Blockers — content (code can be made ready, but de/es content is missing)

### 4. No dictionary for de/es
Only `dictionary-af.db` exists; built by `scripts/build-dictionary.ts`. Needs `dictionary-de.db` / `dictionary-es.db`, plus the path fix (#3).

### 5. Sentence bank is Afrikaans-only and mislabels on seed ⚠️
`src/lib/sentence-bank.json` (656 KB, symlinked to `api/src/lib/sentence-bank.json`) is a **flat list with no `language` field** — all Afrikaans.
- `cloze/seed/route.ts:55` (and the Bun `cloze.ts` seeder) insert every entry with `resolveLanguage()` = the *currently active* language. Seeding while German is active → Afrikaans sentences stored as `language='de'`.
- The `needsSeed` check (`seed/route.ts:69-78`) counts all cloze rows regardless of language.
- **Fix:** per-language banks (e.g. `sentence-bank-<code>.json`) or a `language` field per entry, and seed only the active language's entries.

### 6. Spelling rules (spelreels) are Afrikaans-only — *graceful, not blocking*
`api/src/lib/afrikaans-spelreels/` is af-specific and **already correctly gated** (`lang === 'af'`), so de/es simply get no spelling-rule context. A parity gap to fill eventually, not a blocker.

---

## Cosmetic — UI copy hardcodes "Afrikaans" (wrong, but non-breaking)

| File | What |
|---|---|
| `src/app/journal/page.tsx:163` | Placeholder is literally Afrikaans: _"Skryf vandag se joernaal inskrywing in Afrikaans…"_ |
| `src/components/ChatWidget/index.tsx:310` | _"Ask about Afrikaans…"_ |
| `src/components/ChatWidget/constants.ts:8` | Suggested prompt _"How do diminutives work in Afrikaans?"_ |
| `src/components/PasteImportModal/index.tsx:150` | _"Paste your Afrikaans text here…"_ |
| `src/components/WebImportModal/components/UrlInputStep/index.tsx:74` | _"…Afrikaans news article…"_ |
| `src/app/vocab/page.tsx:38-39,85-87` | Anki deck defaults `'Afrikaans'` / `'Afrikaans::Cloze'` + auto-detect `'afrikaans'` |
| `src/app/practice/constants.ts:4` | `DEFAULT_ANKI_CLOZE_DECK = 'Afrikaans::Cloze'` |
| `src/app/settings/components/Export/index.tsx:22,33,45` | Export filenames `afrikaans-vocab.csv` etc. |
| `src/components/ClozeFeedback/index.tsx:42` | Fallback `|| 'af'` (minor — prefer the registry default) |

**Fix pattern:** pull the display name from `useActiveLanguage().native` and namespace Anki decks/filenames by the active language.

---

## Known issues — tables not partitioned by language

### A. Library groups (confirmed — the gap you flagged)
The `collection_groups` table has **no `language` column**; `groups/route.ts` GET/POST and `data-layer` `getAllGroups`/`createGroup` are language-blind. Collections themselves carry a language, but their parent groups are global — so groups (and any collection-to-group assignment) leak across languages.

### B. Daily-activity stats — half-applied migration ⚠️
`dailyStats` **was migrated** to a composite key `PRIMARY KEY (date, language)` (`database.ts:541-563`, backfilling existing rows as `'af'`), and the **Bun** stats routes honor it via `resolveLanguage()`. But the **live path is the Next.js routes**, and they were never updated to match:
- `recordStudyPing()` (`translate/route.ts:9-13`) and `stats/today` PUT/GET (`stats/today/route.ts`) `INSERT INTO dailyStats (date, …)` **without `language`** → every study ping lands under the default `'af'`, regardless of active language, and reads use `WHERE date = ?` alone.
- `stats/streak` (`stats/streak/route.ts`) aggregates **all** languages — this one is *intentional* (CLAUDE.md: "one streak definition app-wide"), so leave it, but note streak/heatmap are deliberately cross-language.

So today's counters, date-range stats and the heatmap are effectively pinned to `'af'` on the live path. **Two decisions:** (1) make the Next.js write/read paths language-aware to match the schema + Bun routes, and (2) confirm whether streak/heatmap *should* stay global (currently yes) or go per-language.

---

## Maintenance / watch-list (not blockers)

- **Registry duplication:** `src/lib/languages.ts` and `api/src/lib/languages.ts` are two full copies of `LANGUAGES` that must be kept in sync (same mirroring rule as `dates`/`streak` in CLAUDE.md). `src/constants/languages.ts` is just a 3-line `DEFAULT_LANGUAGE` re-export; `src/types/language.ts` holds the canonical types.
- **Tokenization assumptions:** `src/lib/words.ts:13`, `src/lib/definition-links.ts:46`, `src/components/MarkdownReader/utils.ts:30` special-case the Afrikaans `'n` article and Latin diacritics. The `'n` handling is harmless for other languages; verify the diacritic char-class covers German `ß` and Spanish `ñ`/`¿`/`¡` before relying on it.

---

## Benign — leave alone (correct as-is)

- One-time migrations: DB filename `afrikaans.db → lector.db` (`database.ts:9,23`, `api/db.ts:10,22`); localStorage keys `afrikaans-reader-* → lector-*` (`layout.tsx:40`).
- Anki backward-compat tag `tag:afrikaans-reader` OR-clause (`anki.ts:261,264`).
- Registry entries `name: 'Afrikaans'` (correct), comments, and `*.test.ts` fixtures.

---

## Suggested order of work

1. **Registry-drive the three code blockers** (TTS browser mode, Tatoeba code, dictionary path) — small, mechanical, unblocks the engine.
2. **Fix the sentence-bank seeding** (#5) — it's a latent data-corruption bug the moment anyone seeds under a non-af language, independent of whether content exists yet.
3. **Finish the per-language data partitioning:** make the Next.js `dailyStats` read/write paths language-aware (the schema + Bun routes already are), and add `language` to `collection_groups`.
4. **Sweep the cosmetic copy** via `useActiveLanguage().native`.
5. **Produce content** (dictionaries, per-language sentence banks, optional spelling rules) — the long pole.
