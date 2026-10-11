# Vocabulary domain

This domain stores entries that the user owns. It also stores the known-word map. The reader uses `knownWords` for colour. The vocab list uses `vocab`. A save writes both.

## Save vocab and set word state

**App domain:** Vocabulary

There is no Save button. A level, Known, Ignore, keyboard `S`, or Add to Anki creates or updates a row.

```mermaid
flowchart TD
  action[Level, Known, Ignore, S, or Anki] --> apply[ReadPage.applyReaderWordState]
  apply --> patch[patchWordState optimistic colour]
  apply --> row{Vocab row exists?}
  row -->|no| save[saveVocab POST /api/vocab]
  row -->|yes| put[updateVocabState PUT /api/vocab/:id]
  save --> both[Upsert vocab and knownWords]
  put --> both
  action --> cache[persistAcceptedTranslation]
  cache -.-> translation.md
```

Keyboard: `K` marks Known. Keys `1` to `4` set levels. `X` marks Ignore. IME compose skips these keys.

### Key files

| Role | Path | Function |
| --- | --- | --- |
| Reader | `src/app/read/[bookId]/page.tsx` | `setWordLevel`, `markAsKnown`, `ignoreWord`, `saveWordToVocab`, `applyReaderWordState` |
| Colour | `src/components/MarkdownReader/optimistic-word-state.ts` | `patchWordState` |
| Client | `src/lib/data-layer.ts` | `saveVocab`, `updateVocabState`, `getVocabByText` |
| API | `api/src/routes/vocab.ts` | `POST /`, `PUT /:id` |
| Fold | `src/lib/languages.ts` | `foldWord` |

`POST /api/known-words` is not on the drawer path. The reader colours from `GET /api/known-words` at lesson load, then from the optimistic map.

Ignore does not write the translation cache. Known and levels do, for single words with no dict hit. See [translation.md](translation.md#cache-accepted-translation).

Practice mastery 100 calls `updateWordState` in `persistReview`. That is `POST /api/known-words`.

### Word states

`new`, `level1`, `level2`, `level3`, `level4`, `level5`, `level6`, `level7`, `known`, `ignored`.

### Tables

`vocab`, `knownWords`, `dailyStats` (`newWordsSaved`, `wordsMarkedKnown`).

## Vocab list

**App domain:** Vocabulary

| Role | Path | Function |
| --- | --- | --- |
| Page | `src/app/vocab/page.tsx` | `loadData`, `handleUpdateEntry`, `handleDeleteEntry` |
| List | `src/components/VocabList/index.tsx` | `VocabList` |
| Modal | `src/app/vocab/components/VocabDetailModal.tsx` | `handleSave` |
| Client | `src/lib/data-layer.ts` | `getAllVocab`, `updateVocabEntry`, `deleteVocabEntry` |
| API | `api/src/routes/vocab.ts` | `GET /`, `PUT /:id`, `DELETE /:id` |

Filter and page run in memory. `GET /api/vocab` has no `limit`. Delete of the last vocab row for a folded key also deletes `knownWords`.

Tests: `e2e/vocab-edit.spec.ts`, `e2e/vocab-pagination.spec.ts`.

## Known-word import

**App domain:** Vocabulary

Settings, Import Known Words. A plain list writes `knownWords` only. A LingQ CSV also writes `vocab`.

| Role | Path | Function |
| --- | --- | --- |
| UI | `src/app/settings/components/KnownWordsImport/index.tsx` | `importKnownWords`, `importLingQWords` |
| Parse | `src/app/settings/components/KnownWordsImport/utils.ts` | `parseCSVLine`, `lingqStatusToState` |
| Client | `src/lib/data-layer.ts` | `bulkUpdateWordStates`, `saveVocab` |
| API | `api/src/routes/known-words.ts` | `POST /` |

New rows have `domain IS NULL` until the classifier runs. See [stats.md](stats.md).

## Review saved words

**App domain:** Vocabulary

The Practice page has an SRS Review tab. It queues due saved words from `vocab`. Select levels 1 to 7. Optionally filter by one book. The reader has a Review words button that opens the same tab for the current book.

```mermaid
flowchart TD
  entry[Practice SRS tab, or reader Review words] --> start[startSrsRound]
  start --> client[getSrsQueue]
  client --> queue[POST /api/practice/srs-queue]
  queue --> table[(vocab)]
  start --> grade[Answer a translation-recall question]
  grade --> answer[handleSrsAnswer]
  answer --> persist[updateSrsReview]
  persist --> patch[PATCH /api/vocab/update-srs]
  patch --> table
```

| Role | Path | Function |
| --- | --- | --- |
| Practice | `src/app/practice/page.tsx` | `startSrsRound`, `handleSrsAnswer`, `prepareSrsMcOptions` |
| Reader | `src/app/read/[bookId]/page.tsx` | Review words button (`format=srs`, `bookId`) |
| Client | `src/lib/data-layer.ts` | `getSrsQueue`, `updateSrsReview` |
| API | `api/src/routes/practice.ts`, `api/src/routes/vocab.ts` | `POST /api/practice/srs-queue`, `PATCH /api/vocab/update-srs` |

A correct answer moves the level up one, to a maximum of 7. A wrong answer moves the level down one, to a minimum of 1. Interval days per level: level1=0, level2=1, level3=3, level4=7, level5=14, level6=30, level7=90. `next_review` sets the due time. The queue reads `srs_level` and `next_review`, and returns up to 50 words, oldest due first. It is scoped to the active language.
