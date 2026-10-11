# Changelog

## 2026-10-11 10:16

- Fix Shift+Arrow phrase selection: words now visually highlight and the sidebar shows the phrase with spaces and punctuation (e.g. "the cat," not "thecat").
  - `src/components/MarkdownReader/useReaderKeyboardNavigation.ts`: replaced `.map(el => el.textContent).join('')` (which concatenated word spans without spaces) with `readableRangeText(range)` using a DOM `Range` from before the first span to after the last span — same approach as `handleTouchPhrase`. This preserves spaces, punctuation, and skips ruby annotations.
  - Added `onClearPhrase` callback to `NavigationCallbacks` so plain arrow navigation clears the phrase highlight (previously it lingered after Shift+Arrow).
  - `src/components/MarkdownReader/index.tsx`: wired `onClearPhrase` to `clearPhraseHighlight`.
  - `e2e/reader-keyboard-navigation.spec.ts`: fixed selectors from `[data-phrase-highlighted=""]` to `[data-phrase-highlighted]` to match the attribute value convention; added test verifying sidebar displays phrase with spaces.

## 2026-10-11 02:00

- Fix Shift+Arrow to extend phrase selection from a fixed anchor (like text editors) instead of restarting from the cursor on each press. Also triggers a phrase lookup in the drawer as the selection grows.
  - `src/components/MarkdownReader/useReaderKeyboardNavigation.ts`: added `anchorRef` that captures the word position on the first Shift+Arrow press and stays fixed while the cursor extends; each subsequent Shift+Arrow rebuilds the phrase from anchor to cursor via `wordSpansBetween` and calls both `onSelectPhrase` (highlight) and `onLookUpWord` (drawer update); anchor is cleared on plain arrow, Escape, state shortcuts, and mouse click.
  - `src/components/MarkdownReader/index.tsx`: `onSelectPhrase` callback now clears the phrase highlight when the selection collapses to a single word (so the visual state matches a plain cursor).

## 2026-10-11 01:42

- Reader sidebar layout upgrade: docked sidebar extended from `2xl` to `lg+`; mobile drawer converted from right-slide-in panel to bottom sheet (≤45vh); added click-outside-to-close; added auto-scroll of clicked word above the bottom sheet; fixed Escape two-stage conflict with page-level handler; fixed ignore button tooltip to show both `X` and `I` keys.
  - `src/components/TranslationDrawer/slot.tsx`: breakpoint `2xl:flex` → `lg:flex`.
  - `src/components/TranslationDrawer/index.tsx`: `docked` now `screenSize !== 'xs' && screenSize !== 'sm'` (was `=== '2xl'`); mobile drawer repositioned to `fixed inset-x-0 bottom-0 max-h-[45vh]` with `translate-y` slide animation; added `pointerdown` outside-click handler (skips `[data-testid="reader-word"]` targets); added auto-scroll effect for `[data-active-word]` above the 45vh sheet; Escape-to-close handler now active in docked mode (shadowed by hook on reader page); `idle = docked && (!rawIsOpen || !word.trim())` so docked sidebar shows empty state after close.
  - `src/app/read/[bookId]/page.tsx`: layout `2xl:flex-row` → `lg:flex-row`; removed page-level Escape/S keyboard handlers that conflicted with the hook's two-stage Escape and auto-advance.
  - `e2e/reader-sidebar-layout.spec.ts` (new): 5 e2e tests at 1280px (docked layout, Escape ordering) and 800px (bottom sheet, outside-click, word-switch, auto-scroll).
  - `e2e/cloze-definitions.spec.ts`, `e2e/translation-drawer.spec.ts`, `e2e/reader-copy.spec.ts`, `e2e/reader-keyboard-navigation.spec.ts`, `e2e/reader-word-handling.spec.ts`, `e2e/nested-definitions.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/practice.spec.ts`: updated assertions from `translate-x-full` / `not.toBeVisible()` to empty-state checks to match docked sidebar behavior.
  - Rationale: the `lg` breakpoint (1024px) is the standard tablet/desktop threshold, making the sidebar usable on more screens. Bottom-sheet is the conventional mobile pattern and keeps reader content peekable. Outside-click via `pointerdown` (capture) avoids the mousedown/click race that previously prevented it.

## 2026-10-11 00:33

- Add keyboard navigation to the reader article (arrows, Shift+Arrow selection, Escape, k/x/1-4 shortcuts with auto-advance).
  - `src/components/WordCell/index.tsx`: added `blockId` and `wordIndex` props, rendered as `data-block-id` and `data-word-index` attributes for DOM-based navigation queries; added `focus-visible:ring-2` style for keyboard focus.
  - `src/components/MarkdownReader/ReaderArticle/index.tsx`: passes `blockId` and `wordIndex` to each `WordCell`.
  - `src/components/MarkdownReader/useReaderKeyboardNavigation.ts` (new): custom hook listening on `window` for arrow navigation, Shift+Arrow phrase selection, Escape (close drawer), 's' (save word), and k/x/1-4 state shortcuts with auto-advance.
  - `src/components/MarkdownReader/index.tsx`: integrates the hook; added `onReaderStateShortcut`, `onReaderCloseDrawer`, `onReaderSaveWord`, `onReaderLookUpWord` props to `MarkdownReaderProps`; internally wires `onNavigate`, `onSelectPhrase`, `onClearSelection`.
  - `src/components/MarkdownReader/types.ts`: added the four new optional callback props.
  - `src/app/read/[bookId]/page.tsx`: added `handleStateShortcut`, `handleReaderCloseDrawer`, `handleReaderSaveWord`, `handleLookUpWord` callbacks; removed k/x/1-4/escape/s from the window-level keyboard handler (now handled by the hook with auto-advance); kept Cmd+C.
  - `src/components/MarkdownReader/__tests__/useReaderKeyboardNavigation.test.ts` (new): 9 unit tests covering `STATE_SHORTCUTS` mapping and `parseWordElement`.
  - `e2e/reader-keyboard-navigation.spec.ts` (new): 11 e2e tests covering arrow navigation (incl. body focus), Shift+Arrow selection, Escape, Enter lookup, state shortcuts with auto-advance, 's' save, and body/drawer focus edge cases.
  - `e2e/reader-word-handling.spec.ts`: updated `Cmd+number` test to assert `data-word-state` attribute instead of level-button ring (auto-advance moves the drawer to the next word).
  - Rationale: enables rapid vocabulary building — navigate and assign states without touching the mouse. The window-level listener catches keys regardless of focus (reader, body, or portaled drawer).
  - Fix 2026-10-11 01:30: Bug fix batch — (1) Arrow navigation now uses a persistent cursor ref synced from activeWord, so arrows advance from the clicked word instead of always jumping to the first word. (2) Up/Down arrows use getBoundingClientRect geometry to follow visual line wrapping, not DOM order. (3) 'i' added as an alias for the ignore key alongside 'x'. (4) Escape now clears selection on first press and closes the drawer on second press. (5) 's' restored to original behavior (save word to vocab, not level assignment). (6) State shortcuts (k/x/i/1-4) now work from any focus (body, reader, drawer) since the listener is on `window`.

## 2026-09-30 12:55

- Fix read-page handler routing multi-token CJK selections (newline-separated text, accidental multi-sentence drags) to the phrase-translation endpoint instead of failing the word-gloss server guard with `Word must be a single token` (400).
  - `src/app/read/[bookId]/page.tsx`: replaced `word.includes(' ')` token heuristic with `word.trim().split(/\s+/).filter(Boolean).length > 1`. The phrase path already accepts multi-token input; this routes it correctly instead of bouncing it at the server.
  - Rationale: Japanese / Chinese text has no spaces, so `内容について確認しました\nチェックをする` looked like a single word to the old check, then the gloss endpoint's single-token regex rejected it.
  - Risks: low — pure routing change. If the user genuinely clicked a single Japanese word, `tokenCount` is 1 and behaviour is unchanged.

## 2026-10-10 14:46

- Register English ("en") as a monolingual learnable language (English-to-English definitions). Step 1 of two: registration only; the monolingual dictionary script (Step 2) follows next.
  - `languages/types.ts`: added optional `monolingual?: boolean` to `LanguageConfig` so the dictionary builder and lookup layer can branch on same-language glosses.
  - `languages/en/manifest.ts` (new): English manifest with `monolingual: true`, US flag, Google TTS config, and an `avoidWords` stop-word set for the SRS.
  - `languages/registry.ts`: imported `en` and added it to `MANIFESTS` (alphabetically between `eo` and `es`), which widens `LanguageCode` to include `'en'` and surfaces the language in the picker automatically.
  - `src/components/ChatWidget/constants.ts`: added `en` entry to `EXAMPLE_PROMPTS` (type now requires it).
  - `languages/tokenizer/tokenizer.test.ts`: added English text samples to the `CORPUS` legacy-parity goldens (type now requires it; English uses the Latin script the oracle already covers).
  - Rationale: the script-agnostic tokenizer dispatches on `pack.script.kind`, so English (`alpha-spaced`) tokenizes correctly with no code changes. The MarkdownReader already tokenizes by the lesson's language, not the UI language, so a target-language match with the UI language never skips tokenization.
  - Risks: low — no runtime changes for existing languages. Dictionary download for English is not pinned yet (Step 2); lookups fall back to AI until then.

## 2026-10-10 14:57

- Add English dictionary build profile to `scripts/build-dictionary.ts` with multi-language dump filtering. Step 2 of English language registration.
  - Extended `LangProfile` interface: added `langFilter?: string` (skip entries whose `lang` field doesn't match) and `skipEntryTags?: string[]` (skip entries/senses carrying disqualifying tags like form-of, proper-noun, abbreviation).
  - Extended `KaikkiLine` interface: added `lang?: string` and `tags?: string[]`.
  - Extended `KaikkiSense` interface: added `tags?: string[]`.
  - Modified `extractEntry` function: applies `langFilter` check early (before any processing), then checks entry-level and sense-level `tags` against `skipEntryTags`.
  - Added `en` profile to `PROFILES`:
    - `kaikkiUrls`: canonical `/English/` dump URL
    - `letterClass`: `a-zA-Z'-` (apostrophe as token boundary, hyphen for compounds)
    - Empty `prefixes`/`suffixes`: English resolves via kaikki form-of entries + inflection tables
    - `vowels`: `aeiouy`
    - `glossFilter: true`: drops gloss-less entries (large thesaurus section)
    - `langFilter: 'English'`: filters the multi-language dump to English-only entries
    - `skipEntryTags`: drops form-of, alt-of, proper-noun, abbreviation, abbrev, initialism, symbol, punctuation
    - `skipPos`: drops abbrev, initialism, punct, symbol parts of speech
  - Added `scripts/gen-coverage-corpus-en.py`: generates the top-5000 English wordfreq corpus file.
  - Added `scripts/coverage-corpus-en.txt`: 4,911 alpha-filtered English tokens for the coverage gate.
  - Rationale: English Wiktionary's dump is multi-language (entries for every language share one file), so filtering on `lang === "English"` at the entry level is required to keep non-English headwords out of the English dictionary. The skipEntryTags filter prevents form-of and proper-noun entries from crowding the lookup table with no dictionary value.
  - Risks: The English dump is multi-GB; the streaming path handles this, but the first build will download several GB. The skipEntryTags filter may over-prune if kaikki's tag vocabulary differs from expectations; this can be tuned after a test build.

## 2026-10-10 15:02

- Fix `parseLangArg` to accept bare positional language argument (e.g., `build-dictionary.ts en`) in addition to `--lang en`.
  - `scripts/build-dictionary.ts`: `parseLangArg` now checks for non-dash argv entries that match a known PROFILES key, before falling back to `af`.
  - Rationale: the script was only invoked with `--lang` syntax internally; a bare positional argument silently fell through to the `af` default.
  - Risks: low — only adds a new code path; `--lang` syntax unchanged.

- Add English dictionary release placeholders to `dict.env`.
  - Added `en` to the `DICT_LANGS` list (between `de` and `es`, alphabetical).
  - Added placeholder `DICT_VERSION_EN=` and `DICT_SHA256_EN=` lines at the bottom; empty values mean `en` is not yet "published" in the pin manifest (`parseDictEnv` skips languages without both a version and sha256).
  - Rationale: the dictionary build now produces `dictionary-en.db` successfully; the release tag and sha256 will be filled in when a release is cut.
  - Risks: low — the `dict-pins.test.ts` suite verifies that every listed language has a valid pin, and `en` is correctly excluded until values are populated.

- Successfully built English dictionary: 734,875 entries, 1,065,504 senses, 434,108 inflections, 240 MB, 98.3% coverage.
  - `data/dictionary-en.db`: built from the 3.1 GB kaikki English dump (1,492,836 lines).
  - 1,057 glossless entries dropped by `glossFilter`.
  - Coverage 4,827/4,911 wordfreq tokens = 98.3%, well above the 85% threshold.

## 2026-10-10 15:33

- Create English sentence bank generator script (`scripts/build-cloze-en.py`).
  - Modeled after `scripts/build-cloze-it.py` but adapted for a monolingual pack:
    uses `eng-eng_links.tsv` to find paraphrase sentences as "translations".
  - Candidate words come from wordfreq top-N list, filtered only by dictionary
    POS (content words: noun/adj/adv/verb/num/intj; proper nouns excluded).
  - All content words pass through as cloze targets — no stop-word exclusion.
  - Sentence length filtered to 5–20 words; sentences-per-word capped at 6.
  - Downloads Tatoeba `eng_sentences.tsv.bz2` and `eng-eng_links.tsv.bz2`
    (cached in `tmp/cloze-en/`).
  - Prerequisites noted: requires `pip install wordfreq` and the English dict DB.

- Generate English sentence bank (`api/src/lib/sentence-bank-en.json`).
  - 8,859 rows, 1,704/2,000 candidate words covered (85.2%).
  - Collections: top500=2,793, top1000=2,401, top2000=3,665.
  - Cloze targets include all content words — high-frequency ones like "the",
    "and", "in", "with" are intentionally included per user preference.

  - Register `en` in the `SENTENCE_BANKS` map in `api/src/routes/cloze.ts`.
  - Added `en: () => import('../lib/sentence-bank-en.json')` alphabetically
    between `el` and `eo`, following the same lazy-import pattern as all other
    languages.

## 2026-10-10 15:35

- Add `GET /api/dictionary/hint/:word` endpoint for cloze practice definition hints.
  - `api/src/routes/dictionary.ts`: new route calls `lookupWord()` and returns the
    single best sense as `{ hint: { word, gloss, partOfSpeech } }`, or 404 with
    `{ hint: null }` on a miss. Empty/blank word returns 400.
  - `api/src/lib/openapi/annotations.ts`: added `GET /api/dictionary/hint/{word}`
    operation doc with `HintResponse` schema (word, gloss, nullable partOfSpeech).
  - `api/openapi.json`: regenerated (103 endpoints).
  - Rationale: the existing `/lookup` returns all senses + related forms — too much
    information for a hint button. The hint distils to one gloss so the learner must
    still supply the word.
  - Risks: low — GET with word in path; practice cloze targets are not personal data.
    Hint button disabled after reveal to prevent repeated use.

- Add `getHint()` client function and 💡 "Show Definition" button to practice page.
  - `src/lib/dictionary-client.ts`: added `getHint(word: string)` caller +
    `HintResponse` interface `{ word, gloss, partOfSpeech }`.
  - `src/app/practice/page.tsx`: added `definitionHint`/`definitionHintLoading`
    state, `handleDefinitionHint` callback, hint display above type-mode buttons.
    Hint and letter-hint buttons are both disabled once a definition hint is shown.
    State resets in `prepareSentence`.
  - `api/src/routes/dictionary.test.ts`: added 3 tests — cache hit returns top
    sense, cache miss returns 404 with null hint, empty word returns 400.
  - Note: `usedHint` tracking is client-side only — no DB column added (Free plan
    takeout budget margin is < 170 KiB; a per-sentence boolean would exceed it).

- Update stale `free-takeout-budget.test.ts` expected byte count for the `en` pack.
  - `api/src/lib/free-takeout-budget.test.ts`: expected `totalBytes` updated from
    `93_302_998` to `93_303_474` (the test comment predicts "~466 bytes per language
    pack"; the actual delta from `en` is ~476 bytes, consistent with that projection).
  - Rationale: this failure was pre-existing on the branch (the `en` language pack
    was registered in `languages/registry.ts` before this session began).
  - Risks: none — the assertion still enforces `totalBytes <= FREE_RESTORE_ENVELOPE`
    and a > 1 MiB margin on the 90 MiB Free envelope.

## 2026-10-10 15:45

- Fix monolingual-aware defaults for the 💡 definition hint and translation toggle.
  - `src/lib/dictionary-client.ts`: `getHint()` return type changed from
    `HintResponse | null` to a `HintResult` discriminated union that
    distinguishes `{ ok: true, hint }` from `{ ok: false, reason: 'not-found' | 'error' }`.
  - `src/app/practice/page.tsx`:
    - Computed `isMonolingual` from `getActivePack().monolingual`.
    - On mount and in `init()` effect: for monolingual packs, `showTranslation`
      defaults to `false` (EN→EN translation is meaningless). Non-monolingual
      packs keep the existing behavior.
    - Added `definitionHintStatus` state (`'idle' | 'not-found' | 'error'`).
    - Added `useEffect` that auto-fires `getHint` on each new question for
      monolingual packs (definition defaults to ON). Keyed on `current.sentence.id`.
    - Shows a visible "No definition available for this word." message (with
      `data-testid="hint-not-found"`) when the hint lookup 404s, instead of
      failing silently. Error toasts on transport failures.
    - The 💡 button already showed "…" while loading; now also disabled when
      `definitionHintStatus !== 'idle'` (prevents re-clicks after a miss).
    - Failed lookups are logged to `console.warn` with the word and language.
  - Rationale: previously the 💡 button appeared dead on words not in the
    dictionary; now it always gives feedback. Monolingual packs (English EN→EN)
    benefit from a definition hint by default and don't need a foreign translation.
  - Risks: monolingual auto-hint adds one SQLite read per question (no AI call
    on miss, so cost is negligible). The endpoint already resolves the active
    language via `getActiveLanguage()` — no hardcoded default was found.

- Fix blank input animation (grow-and-snap) triggered by state changes on practice page.
  - `src/app/practice/page.tsx`: replaced `transition-all` with `transition-colors`
    on the type-mode input (prevents width/min-width transitions from firing on
    every `inputColorClass` or `fuzzyStatus` change). Added stable `key` attributes
    (`blank-input-${id}` / `blank-span-${id}`) tied to the question id. Added
    `transition-none` to the MC-mode blank span.
  - Rationale: `transition-all` animated every CSS property change, so clicking
    💡 or Hint caused the blank to briefly resize before settling — jarring and
    wasteful. `transition-colors` limits animation to color-only.

- Fix `TypeError: sentences.map is not a function` crash in cloze data layer.
  - `src/lib/data-layer.ts`: added `Array.isArray(sentences)` guards to all six
    cloze-sentence fetch functions (`getClozeSentencesByCollection`,
    `getNewSentencesByCollection`, `getClozeSentencesDueForReview`,
    `getAllClozeSentences`, `getClozeSentencesForWord`, `getOnboardingCloze`).
    When the API returns an error JSON object (e.g. 401/429) instead of an array,
    these now return `[]` instead of crashing.
  - Rationale: the crash occurred because `apiFetch` returns the raw Response
    even for error statuses, and callers called `res.json().map()` without
    checking. The defensive guard degrades gracefully to an empty sentence list.
