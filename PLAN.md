# Afrikaans Reader

A Lingq replacement for reading Afrikaans books, mining sentences, and building vocabulary.

## Why

- Lingq subscription is expensive
- Have Afrikaans epubs to read
- Want sentence mining workflow → Anki
- Marrying a South African, learning the language

---

## MVP Features

### 1. Epub Import & Library
- Import .epub files (stored locally in IndexedDB)
- Library view showing all imported books
- Book metadata: title, author, cover image

### 2. Reading View
- Clean, distraction-free chapter rendering
- Chapter navigation (prev/next, table of contents)
- Track reading progress per book (chapter + scroll position)
- Resume where you left off

### 3. Word/Phrase Translation
- Click word → popup with translation (Claude API, context-aware)
- Shift+click+drag → select phrase → translate phrase
- Translation considers sentence context for accuracy

### 4. Vocabulary Saving
- Save word or phrase to vocabulary list
- Automatically captures:
  - The word/phrase
  - Full sentence for context
  - Translation
  - Book source + chapter
  - Timestamp

### 5. AnkiConnect Integration
- Push cards directly to Anki via AnkiConnect REST API
- Card format:
  - Front: Afrikaans sentence (target word highlighted)
  - Back: Translation + word meaning
- Configure target deck name
- One-click "Send to Anki" from vocab list or inline

### 6. Vocabulary Review
- View saved vocabulary
- Filter by book, date, status
- Bulk export to Anki if needed
- Mark words as "learned" (optional)

---

## Stretch Goals

### Known Words Tracking
- Mark words as "known" → they become invisible (no highlight/lookup needed)
- Import existing vocabulary list if available
- Track vocabulary growth over time (words known per week/month)
- Stats: "You know ~2,500 Afrikaans words"

### Podcast Transcription
- Drop audio file (.mp3, .m4a)
- Transcribe via Whisper (API or local)
- Output as readable text for sentence mining
- Same reading/mining interface as epubs

### Web Import
- Paste URL → extract article text via readability
- Or: browser bookmarklet to send current page to reader
- Same reading/mining interface
- Good for news articles (Netwerk24, Die Burger, etc.)

---

## Technical Plan

### Stack
- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** for styling
- **epub.js** for epub parsing and rendering
- **Claude API** for translation
- **IndexedDB** (via Dexie.js) for local storage
- **AnkiConnect** for Anki integration

### Project Structure
```
afrikaans-reader/
├── app/
│   ├── page.tsx              # Library view
│   ├── read/[bookId]/page.tsx # Reading view
│   ├── vocab/page.tsx        # Vocabulary list
│   └── settings/page.tsx     # Settings (Anki deck, API key)
├── components/
│   ├── BookCard.tsx
│   ├── Reader.tsx
│   ├── TranslationPopup.tsx
│   ├── VocabList.tsx
│   └── AnkiPushButton.tsx
├── lib/
│   ├── epub.ts               # Epub parsing utilities
│   ├── claude.ts             # Claude API wrapper
│   ├── anki.ts               # AnkiConnect client
│   ├── db.ts                 # IndexedDB schema & queries
│   └── whisper.ts            # Audio transcription (stretch)
├── types/
│   └── index.ts              # TypeScript types
└── public/
```

### Data Models

```typescript
interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  epubData: ArrayBuffer;
  progress: {
    chapter: number;
    scrollPosition: number;
    percentComplete: number;
  };
  createdAt: Date;
  lastReadAt: Date;
}

interface VocabEntry {
  id: string;
  word: string;
  sentence: string;
  translation: string;
  wordTranslation: string;
  bookId?: string;
  chapter?: number;
  createdAt: Date;
  pushedToAnki: boolean;
  known: boolean;
}

interface Settings {
  ankiDeckName: string;
  claudeApiKey: string;
  knownWords: string[];
}
```

### AnkiConnect Integration

AnkiConnect exposes REST API on `localhost:8765`. Key endpoints:
- `addNote` - create a new card
- `deckNames` - list available decks
- `findNotes` - check for duplicates

Card template:
```
Front: {{Sentence}} (with {{Word}} in bold)
Back: {{SentenceTranslation}}
      ---
      {{Word}}: {{WordTranslation}}
```

### Claude API Usage

Translation prompt structure:
```
Translate the following Afrikaans to English. The word/phrase in [brackets] is what the user is specifically asking about - provide extra detail for that.

Sentence: "Ek het gister 'n [mooi] boek gelees."

Respond with:
1. Full sentence translation
2. Specific meaning of [mooi] in this context
```

---

## Implementation Order

### Phase 1: Core Reading (Day 1)
1. Project setup (Next.js, Tailwind, TypeScript)
2. IndexedDB setup with Dexie
3. Epub import and storage
4. Basic library view
5. Reader component with epub.js
6. Chapter navigation
7. Progress tracking

### Phase 2: Translation (Day 1-2)
1. Claude API integration
2. Word selection detection
3. Translation popup component
4. Phrase selection (shift+drag)
5. Context-aware translation prompts

### Phase 3: Vocabulary & Anki (Day 2)
1. Save vocab entries to IndexedDB
2. Vocabulary list view
3. AnkiConnect integration
4. Push single card to Anki
5. Bulk push functionality

### Phase 4: Polish (Day 3)
1. Settings page (API key, deck name)
2. Reading progress persistence
3. Resume reading
4. Dark mode
5. Mobile-responsive design

### Stretch (Future)
1. Known words tracking
2. Whisper integration for podcasts
3. Web article import enhancements
4. Daily study tracking webhook

### Daily Study Tracking
A lightweight way for external tools (Sphere Guardian, etc.) to know whether study happened today.

**Option A — API route (simple):**
- `POST /api/study-ping` — called automatically when a session starts (first word lookup or page turn)
- `GET /api/study-ping` — returns `{ done: true, date: "2026-03-14", minutes: 12 }` or `{ done: false }`
- Persists to a local JSON file (`data/study-log.json`) keyed by date

**Option B — passive detection (no action needed):**
- Track session activity in IndexedDB already
- Expose a Next.js API route that reads it: `GET /api/today` → `{ studiedToday: boolean, wordsLooked up: N }`

**Integration with Sphere Guardian:**
- Sphere MCP `get_week_summary` could call this endpoint to report Afrikaans status accurately
- Or: a cron/hook that pings Sphere when a session closes

Recommended: Option A (explicit ping) — simplest, works even offline, easy to call from MCP.

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "epubjs": "^0.3",
    "dexie": "^4",
    "@anthropic-ai/sdk": "^0.24"
  }
}
```

---

## Notes

- All data stored locally (IndexedDB) — your books, your vocab, your data
- Claude API key needed for translations (store in localStorage or env)
- AnkiConnect plugin must be installed in Anki desktop
- No backend needed — fully client-side except API calls

---

## Import Roadmap

### URL Import Enhancements

Current URL import works but may fail on JS-heavy sites and strips formatting inconsistently.

**Better content extraction**
- Swap or supplement current parser with [mozilla/readability](https://github.com/mozilla/readability) (same engine as Firefox Reader View)
- Add JSDOM for server-side HTML parsing to strip ads, nav, footers

**Handle JS-rendered pages**
- Optional Playwright/Puppeteer fetch path in the API route, triggered when initial fetch returns no readable content

**Metadata extraction**
- Pull `og:title`, `og:author`, `article:author` meta tags to auto-populate modal fields

**Afrikaans news source presets**
- Quick-import shortcuts for known Afrikaans sources: Netwerk24, Die Burger, Volksblad
- Preset list in the URL modal

---

### Whisper Podcast Transcription

Much Afrikaans content is audio-first (podcasts, sermons, radio). Goal: import audio for reading/vocab practice.

**Phase 1: Manual audio upload**
- Add "Transcribe Audio" option in `ImportDropdown`
- Accepts `.mp3`, `.m4a`, `.wav`, `.ogg`
- `POST /api/transcribe` sends to OpenAI Whisper API with `language: "af"`
- Returns transcript as markdown text → creates a book entry

**Phase 2: Podcast URL**
- Accept a podcast episode URL or RSS feed URL
- Fetch audio server-side → pipe through Whisper
- Auto-populate title from podcast RSS metadata

**Phase 3: Background processing**
- Transcription takes 30–120s for a full episode
- Show "processing" state on library card with polling
- Browser notification or in-app alert when done

**API shape:**
```
POST /api/transcribe
  body: FormData { audio: File, hint?: string }
  → { transcript: string, duration: number, language: string }
```

**Notes:**
- `language: "af"` improves Whisper accuracy significantly
- `prompt` param can seed common Afrikaans words to reduce errors
- Cost: ~$0.006/min — a 30min episode ≈ $0.18
- Cache transcripts by audio hash to avoid re-processing

**Dependencies:**
```bash
npm install openai        # Whisper API client
npm install formidable    # multipart form handling
```

---

### Other Backlog

- **YouTube**: Pull Afrikaans auto-subs via `yt-dlp`, import as text
- **Clipboard shortcut**: Send selected text directly to reader via browser extension or bookmarklet
- **Anki export**: Export vocab list as `.apkg` deck file
- **Sphere Guardian push**: HTTP endpoint on sphere-guardian server so the app can notify it when a session completes (instead of sphere-guardian polling)
