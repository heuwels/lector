# Anki domain

This domain pushes cards out. It also writes the state of reviews back to Lector. Transport is AnkiConnect or the Lector Sync add-on.

`useAnkiTransport` in `src/lib/anki-transport.ts` chooses the path. Cloud always uses `addon`. Self-host reads `settings.ankiTransport` and defaults to `ankiconnect`.

## Push to Anki

**App domain:** Anki

Sources: reader drawer, vocab export, practice feedback.

```mermaid
flowchart TD
  add[Add word or cloze] --> transport{ankiTransport}
  transport -->|ankiconnect| anki[anki.ts addWordCard / addClozeCard]
  anki --> http["POST localhost:8765 addNote"]
  http --> mark[markVocabPushedToAnki]
  transport -->|addon| queue[queueForAnki]
  queue --> post["POST /api/anki/queue"]
  post --> pending[anki_pending]
  pending --> addon[Add-on GET /api/anki/pending]
  addon --> ack["POST /api/anki/ack"]
```

### Key files

| Role | Path | Function |
| --- | --- | --- |
| Transport | `src/lib/anki-transport.ts` | `useAnkiTransport` |
| AnkiConnect | `src/lib/anki.ts` | `addWordCard`, `addClozeCard`, `addBasicCard`, `ankiRequest` |
| Queue | `src/lib/anki-queue.ts` | `queueForAnki` |
| Reader | `src/app/read/[bookId]/page.tsx` | `addWordToAnki`, `addClozeToAnki` |
| Vocab | `src/app/vocab/page.tsx` | `handleExportToAnki` |
| Settings | `src/app/settings/components/AnkiSettings/index.tsx` | `AnkiSettings` |
| API | `api/src/routes/anki.ts` | `POST /queue`, `GET /pending`, `POST /ack` |
| Protocol | `api/src/lib/anki-protocol.ts` | `addonProtocol` |
| Add-on | `anki-addon/lector/sync.py` | `apply_pending`, `_upsert_note` |
| Note types | `anki-addon/lector/notetypes.py` | `ensure_models` |

### Branches

- Cloze that cannot wrap the target word fails at queue or at `addClozeCard`.
- Re-queue bumps `anki_pending.version`. An ack that is stale cannot remove the new row.
- When the reader has a `WordSource`, transcript source fields are present.
- The add-on upserts by `LectorId`. The browser uses note types Basic and Cloze with tag `lector`.
- `GET /api/anki` and `POST /api/anki` still proxy AnkiConnect. The web client does not use them for export.

### Tables

`vocab` columns `pushedToAnki` and `ankiNoteId`, plus `anki_pending` and `settings`. Token scopes are `anki:read` and `anki:write` on `api_tokens`.

### Tests

`e2e/reader-anki.spec.ts`, `e2e/vocab-anki-export.spec.ts`, `e2e/anki-addon.spec.ts`.

## Sync Anki reviews

**App domain:** Anki

Two writers: vocab state, and heatmap day counts.

```mermaid
flowchart TD
  sync[Sync] --> transport{Transport}
  transport -->|ankiconnect vocab| cards[anki.ts syncWordStates]
  cards --> reconcile[reconcileAnkiStates]
  reconcile --> vocab[updateVocabState or saveVocab]
  transport -->|ankiconnect heatmap| days["POST /api/anki/sync-reviews"]
  days --> ankiConnect[getNumCardsReviewedByDay]
  transport -->|addon| reviews["POST /api/anki/reviews"]
  reviews --> map[ankiCardToState]
  map --> vocab
  reviews --> heatmap[upsertAnkiReviewDays]
```

| Role | Path | Function |
| --- | --- | --- |
| Client | `src/lib/anki.ts` | `syncWordStates`, `ankiCardToState`, `reconcileAnkiStates` |
| Vocab page | `src/app/vocab/page.tsx` | `handleSyncWithAnki` |
| Stats | `src/app/stats/page.tsx` | `syncAnkiReviews` |
| Client | `src/lib/data-layer.ts` | `syncAnkiReviews` |
| API | `api/src/routes/anki.ts` | `POST /reviews`, `POST /sync-reviews` |
| Add-on | `anki-addon/lector/sync.py` | `post_reviews`, `flush_reviews` |

Upgrade only. The path never demotes and never touches `ignored`. New Anki cards (`type === 0`) skip. Map: Learning to `level1`, Relearning to `level2`, Young to `level4`, Mature to `known`.

Unreachable AnkiConnect on `/sync-reviews` returns `{ connected: false, synced: 0 }` and does not wipe data.

Tests: `e2e/vocab-anki-sync.spec.ts`, `e2e/anki-stats.spec.ts`.
