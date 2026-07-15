// AnkiConnect API client — direct browser-to-local connection.
// AnkiConnect must be running on localhost:8765 by default.
// In Anki: Tools > Add-ons > AnkiConnect > Config, ensure webCorsOriginList
// includes "*" or your app origin.
//
// The URL is overridable via the `ankiConnectUrl` setting so a user with a
// remote Anki install (e.g. over Tailscale) can point at http://100.x.x.x:8765.

import { splitTrailingPunctuation } from './words';
import { foldWord } from './languages';
import { getActivePack } from './data-layer';
import type { WordState } from '@/types';
import { apiFetch } from './api-base';

const DEFAULT_ANKI_CONNECT_URL = 'http://localhost:8765';

let _cachedUrl: string | null = null;
let _inflight: Promise<string> | null = null;

/**
 * Resolve the AnkiConnect URL, reading from /api/settings on first call and
 * caching the result. Call `refreshAnkiUrl()` after the user updates the
 * setting so the next request uses the new value.
 */
async function getAnkiUrl(): Promise<string> {
  if (_cachedUrl) return _cachedUrl;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const res = await apiFetch('/api/settings/ankiConnectUrl');
      if (res.ok) {
        const value = (await res.json()) as string | null | undefined;
        if (typeof value === 'string' && value.trim()) {
          _cachedUrl = value.trim();
          return _cachedUrl;
        }
      }
    } catch {
      // Fall through to default
    }
    _cachedUrl = DEFAULT_ANKI_CONNECT_URL;
    return _cachedUrl;
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Invalidate the cached URL so the next AnkiConnect call re-reads the setting. */
export function refreshAnkiUrl(): void {
  _cachedUrl = null;
  _inflight = null;
}

interface AnkiConnectResponse<T = unknown> {
  result: T;
  error: string | null;
}

interface CardInfo {
  cardId: number;
  fields: Record<string, { value: string; order: number }>;
  interval: number;
  // 0 = New, 1 = Learning, 2 = Review (Young/Mature), 3 = Relearning
  type: number;
  note: number;
  deckName: string;
}

// Rank used for upgrade-only sync (ignored shares known's rank so it is never overridden).
const STATE_RANK: Record<WordState, number> = {
  new: 0,
  level1: 1,
  level2: 2,
  level3: 3,
  level4: 4,
  known: 5,
  ignored: 5,
};

/**
 * Map a raw Anki card (type + interval) to a lector vocab state, or `null` when
 * the card carries no learning signal yet. A New card is queued in Anki but has
 * never been studied, so the sync ignores it entirely — it neither upgrades an
 * existing entry nor imports a new word.
 *
 * New (0)            → null     — queued but not yet studied; ignored
 * Learning (1)       → level1   — in initial learning steps
 * Relearning (3)     → level2   — lapsed, being relearned
 * Young (2, < 21 d)  → level4   — graduated to review, almost known
 * Mature (2, ≥ 21 d) → known    — stable long-term recall; treat as known
 */
export function ankiCardToState(type: number, interval: number): WordState | null {
  if (type === 0) return null;
  if (type === 1) return 'level1';
  if (type === 3) return 'level2';
  return interval >= 21 ? 'known' : 'level4';
}

/**
 * Given existing vocab entries and the Anki state map, find Anki words that
 * have no matching entry in lector yet. Returns them ready to be created.
 *
 * Pure function — no side effects, easily unit-testable.
 */
export function findNewAnkiWords(
  existingEntries: ReadonlyArray<{ text: string }>,
  ankiStates: ReadonlyMap<
    string,
    { type: number; interval: number; sentence: string; translation: string }
  >,
): Array<{ text: string; state: WordState; sentence: string; translation: string }> {
  const existingWords = new Set(existingEntries.map((e) => e.text.toLowerCase()));
  const newWords: Array<{ text: string; state: WordState; sentence: string; translation: string }> =
    [];
  for (const [word, data] of ankiStates) {
    if (existingWords.has(word)) continue;
    const state = ankiCardToState(data.type, data.interval);
    if (!state) continue; // New card → don't import an unstudied word
    newWords.push({
      text: word,
      state,
      sentence: data.sentence,
      translation: data.translation,
    });
  }
  return newWords;
}

/**
 * Given existing vocab entries and the Anki state map, compute which entries
 * should be upgraded. Only returns entries that would move to a higher state;
 * never demotes, and always skips `ignored` entries.
 *
 * Pure function — no side effects, easily unit-testable.
 */
export function reconcileAnkiStates(
  entries: ReadonlyArray<{ id: string; text: string; state: WordState }>,
  ankiStates: ReadonlyMap<string, { type: number; interval: number }>,
): Array<{ id: string; newState: WordState }> {
  const updates: Array<{ id: string; newState: WordState }> = [];
  for (const entry of entries) {
    if (entry.state === 'ignored') continue;
    const ankiData = ankiStates.get(entry.text.toLowerCase());
    if (!ankiData) continue;
    const newState = ankiCardToState(ankiData.type, ankiData.interval);
    if (!newState) continue; // New card → no learning signal, leave entry as-is
    if (STATE_RANK[newState] > STATE_RANK[entry.state]) {
      updates.push({ id: entry.id, newState });
    }
  }
  return updates;
}

/**
 * Make a request directly to AnkiConnect on localhost
 */
async function ankiRequest<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  const url = await getAnkiUrl();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect error: ${response.status}`);
  }

  const data = (await response.json()) as AnkiConnectResponse<T>;

  if (data.error) {
    throw new Error(`AnkiConnect error: ${data.error}`);
  }

  return data.result;
}

/**
 * Check if Anki is running and AnkiConnect is available
 */
export async function isAnkiConnected(): Promise<boolean> {
  try {
    const url = await getAnkiUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'version', version: 6 }),
    });
    const data = await response.json();
    return data.result != null && data.error == null;
  } catch {
    return false;
  }
}

/**
 * Get all deck names from Anki
 */
export async function getDeckNames(): Promise<string[]> {
  return ankiRequest<string[]>('deckNames');
}

/**
 * Create a deck if it doesn't exist
 * @param deckName - Name of the deck to create
 */
async function ensureDeckExists(deckName: string): Promise<void> {
  await ankiRequest('createDeck', { deck: deckName });
}

/**
 * Add a basic (front/back) card to Anki
 * @param deckName - Name of the deck to add the card to
 * @param sentence - The Afrikaans sentence containing the target word
 * @param targetWord - The word being learned
 * @param translation - English translation of the sentence
 * @param wordMeaning - English meaning of the target word
 * @returns The note ID of the created card
 */
export async function addBasicCard(
  deckName: string,
  sentence: string,
  targetWord: string,
  translation: string,
  wordMeaning: string,
): Promise<number> {
  console.log(`[Anki] Adding basic card to deck "${deckName}" for word "${targetWord}"`);

  await ensureDeckExists(deckName);

  // Bank words can carry trailing punctuation ("haar.") which would make the
  // word-boundary pattern unmatchable — match and display the clean form
  // (#68, #108).
  const [cleanTarget] = splitTrailingPunctuation(targetWord);

  // Highlight the target word in the sentence. Unicode-aware boundaries
  // (#289): \b is ASCII-only, so it saw a boundary inside "Häuser" at the ä
  // and happily highlighted embedded fragments; the lookarounds treat any
  // letter/digit neighbor as word-internal, in every script.
  const highlightedSentence = sentence.replace(
    new RegExp(`(?<![\\p{L}\\p{N}_])(${escapeRegex(cleanTarget)})(?![\\p{L}\\p{N}_])`, 'giu'),
    '<b>$1</b>',
  );

  const noteId = await ankiRequest<number | null>('addNote', {
    note: {
      deckName,
      modelName: 'Basic',
      fields: {
        Front: `${highlightedSentence}<br><br><small>Word: <b>${cleanTarget}</b></small>`,
        Back: `${translation}<br><br><b>${cleanTarget}</b> = ${wordMeaning}`,
      },
      options: {
        allowDuplicate: true, // Allow duplicates - same word from different sentences is fine
      },
      tags: ['lector', 'vocabulary'],
    },
  });

  // AnkiConnect returns null if the note couldn't be added
  if (noteId === null) {
    throw new Error(
      "Failed to add note - check that 'Basic' note type exists with 'Front' and 'Back' fields",
    );
  }

  console.log(`[Anki] Successfully added basic note with ID: ${noteId}`);
  return noteId;
}

/**
 * Add a pure word flashcard to Anki (issue #197).
 * Front: the word only (bold, so syncWordStates can round-trip it).
 * Back: translation + word = meaning line.
 */
export async function addWordCard(
  deckName: string,
  targetWord: string,
  translation: string,
  wordMeaning: string,
  sourceHtml?: string,
): Promise<number> {
  await ensureDeckExists(deckName);
  const [cleanTarget] = splitTrailingPunctuation(targetWord);
  const sourceLine = sourceHtml ? `<br><br><small>${sourceHtml}</small>` : '';

  const noteId = await ankiRequest<number | null>('addNote', {
    note: {
      deckName,
      modelName: 'Basic',
      fields: {
        Front: `<b>${cleanTarget}</b>`,
        Back: `${translation}<br><br><b>${cleanTarget}</b> = ${wordMeaning}${sourceLine}`,
      },
      options: { allowDuplicate: true },
      tags: ['lector', 'vocabulary'],
    },
  });

  if (noteId === null) {
    throw new Error(
      "Failed to add note — check that 'Basic' note type exists with 'Front' and 'Back' fields",
    );
  }

  return noteId;
}

/**
 * Build the cloze-deletion text for a sentence. Strips trailing punctuation
 * from the target first — bank words can carry it ("haar."), which would make
 * the word-boundary pattern unmatchable and produce a cloze-less note that
 * AnkiConnect rejects (#68, #108). Punctuation stays outside the blank.
 * Unicode-aware boundaries (#289): ASCII \b mismatched every non-Latin script
 * and false-matched inside diacritic words. Exported for tests.
 */
export function buildClozeText(sentence: string, targetWord: string): string {
  const [cleanTarget] = splitTrailingPunctuation(targetWord);
  return sentence.replace(
    new RegExp(`(?<![\\p{L}\\p{N}_])(${escapeRegex(cleanTarget)})(?![\\p{L}\\p{N}_])`, 'giu'),
    '{{c1::$1}}',
  );
}

/**
 * Add a cloze deletion card to Anki
 * @param deckName - Name of the deck to add the card to
 * @param sentence - The Afrikaans sentence containing the target word
 * @param targetWord - The word being learned (will be hidden in cloze)
 * @param translation - English translation of the sentence
 * @param wordMeaning - English meaning of the target word
 * @returns The note ID of the created card
 */
export async function addClozeCard(
  deckName: string,
  sentence: string,
  targetWord: string,
  translation: string,
  wordMeaning: string,
  sourceHtml?: string,
): Promise<number> {
  console.log(`[Anki] Adding cloze card to deck "${deckName}" for word "${targetWord}"`);

  await ensureDeckExists(deckName);

  const [cleanTarget] = splitTrailingPunctuation(targetWord);
  const clozeText = buildClozeText(sentence, targetWord);
  const sourceLine = sourceHtml ? `<br><br><small>${sourceHtml}</small>` : '';

  // A note without a {{c1::…}} blank is invalid — fail with a clear message
  // instead of letting AnkiConnect reject it opaquely.
  if (!clozeText.includes('{{c1::')) {
    throw new Error(`Could not build cloze: "${cleanTarget}" not found in sentence`);
  }

  console.log(`[Anki] Cloze text: ${clozeText}`);

  const noteId = await ankiRequest<number | null>('addNote', {
    note: {
      deckName,
      modelName: 'Cloze',
      fields: {
        Text: `${clozeText}<br><br><small>Translation: ${translation}</small>`,
        Extra: `<b>${cleanTarget}</b> = ${wordMeaning}${sourceLine}`,
      },
      options: {
        allowDuplicate: true, // Allow duplicates - user may want the same word from different sentences
      },
      tags: ['lector', 'vocabulary', 'cloze'],
    },
  });

  // AnkiConnect returns null if the note couldn't be added
  if (noteId === null) {
    throw new Error(
      "Failed to add note - check that 'Cloze' note type exists with 'Text' and 'Extra' fields",
    );
  }

  console.log(`[Anki] Successfully added note with ID: ${noteId}`);
  return noteId;
}

/** Strip HTML tags and trim whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the sentence context from card fields (best-effort).
 * Basic Front: "{sentence}<br><br><small>Word: <b>word</b></small>"
 * Cloze Text:  "{sentence{{c1::word}}}<br><br><small>Translation: ...</small>"
 */
function extractSentence(frontField: string, textField: string): string {
  const raw = frontField || textField;
  if (!raw) return '';
  const beforeBreak = raw.split(/<br\s*\/?><br\s*\/?>/i)[0] ?? '';
  return stripHtml(beforeBreak.replace(/\{\{c\d+::([^}]+)\}\}/g, '$1'));
}

/**
 * Extract the translation from card fields (best-effort).
 * Basic Back:  "{translation}<br><br><b>word</b> = meaning"
 * Cloze Text:  "...<small>Translation: {translation}</small>"
 * Cloze Extra: "<b>word</b> = meaning"
 */
function extractTranslation(backField: string, textField: string, extraField: string): string {
  // Cloze: translation embedded in Text field
  const clozeMatch = textField.match(/Translation:\s*([^<]+)/i);
  if (clozeMatch) return clozeMatch[1].trim();

  // Basic: first segment of Back field
  if (backField) {
    const beforeBreak = backField.split(/<br\s*\/?><br\s*\/?>/i)[0] ?? '';
    const text = stripHtml(beforeBreak);
    if (text) return text;
  }

  // Extra field fallback: "<b>word</b> = meaning"
  if (extraField) {
    const eqMatch = extraField.match(/=\s*(.+)$/);
    if (eqMatch) return stripHtml(eqMatch[1]);
  }

  return '';
}

/**
 * Query AnkiConnect for all lector-created cards (tagged `lector` or
 * `afrikaans-reader`) and return a map of
 * word → { type, interval, sentence, translation, deckName }.
 * When a word has multiple cards the one that maps to the highest lector
 * state is kept.
 *
 * The sync is scoped to lector's own tags on purpose — every card lector
 * exports is tagged, so this catches all of them. It deliberately does NOT
 * scan whole decks: that sweeps in the user's hand-made cards (custom note
 * types, English-fronted Basic cards) that lector can't reliably read a word
 * from, producing junk imports.
 */
export async function syncWordStates(): Promise<
  Map<
    string,
    { interval: number; type: number; sentence: string; translation: string; deckName: string }
  >
> {
  const query = '(tag:lector OR tag:afrikaans-reader)';
  console.log(`Anki sync query: ${query}`);
  const cardIds = await ankiRequest<number[]>('findCards', { query });
  console.log(`Found ${cardIds.length} cards in Anki`);

  if (cardIds.length === 0) {
    return new Map();
  }

  // Get card info
  const cardsInfo = await ankiRequest<CardInfo[]>('cardsInfo', {
    cards: cardIds,
  });

  // Build a map of word -> { type, interval, sentence, translation, deckName }
  const wordStates = new Map<
    string,
    { interval: number; type: number; sentence: string; translation: string; deckName: string }
  >();

  for (const card of cardsInfo) {
    // Extract the target word. Try in order:
    // 1. Bold text (our format): <b>word</b>
    // 2. Dedicated Word field
    // 3. Plain Front field (simple vocab cards, ≤ 50 chars, no full stop)
    // 4. Cloze text: {{c1::word}} pattern

    let word: string | null = null;

    const frontField = card.fields['Front']?.value || '';
    const textField = card.fields['Text']?.value || '';
    const backField = card.fields['Back']?.value || '';
    const extraField = card.fields['Extra']?.value || '';
    const wordField = card.fields['Word']?.value || '';

    const boldMatch = (frontField || textField).match(/<b>([^<]+)<\/b>/);
    if (boldMatch) {
      word = boldMatch[1];
    } else if (wordField) {
      word = wordField.replace(/<[^>]*>/g, '').trim();
    } else if (frontField) {
      const plainText = frontField.replace(/<[^>]*>/g, '').trim();
      if (plainText.length < 50 && !plainText.includes('.')) {
        word = plainText.split(/\s+/)[0];
      }
    } else if (textField) {
      const clozeMatch = textField.match(/\{\{c\d+::([^}]+)\}\}/);
      if (clozeMatch) {
        word = clozeMatch[1];
      }
    }

    if (word) {
      // Anki card text is an external ingress (#289): fold like every other
      // vocab key so decomposed input still matches lector entries.
      word = foldWord(word.trim(), getActivePack());
      const cardState = ankiCardToState(card.type, card.interval);
      // Skip New cards — they carry no learning signal and must not occupy a
      // word slot, so a word whose only cards are New stays out of the sync.
      if (cardState) {
        // Keep the card that maps to the highest lector state (dedup by rank).
        const existing = wordStates.get(word);
        const cardRank = STATE_RANK[cardState];
        const existingState = existing ? ankiCardToState(existing.type, existing.interval) : null;
        const existingRank = existingState ? STATE_RANK[existingState] : -1;
        if (cardRank > existingRank) {
          wordStates.set(word, {
            interval: card.interval,
            type: card.type,
            sentence: extractSentence(frontField, textField),
            translation: extractTranslation(backField, textField, extraField),
            deckName: card.deckName,
          });
        }
      }
    }
  }

  console.log(
    `Extracted ${wordStates.size} unique words from Anki cards:`,
    Array.from(wordStates.keys()).slice(0, 10).join(', ') + (wordStates.size > 10 ? '...' : ''),
  );
  return wordStates;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** mm:ss / h:mm:ss label for a millisecond offset (#334). Mirrors
 *  formatClipTimestamp in api/src/lib/anki.ts. */
export function formatClipTimestamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render the Anki "Source" line for a card mined from a video transcript
 * (#334): a link to the source video at the segment start, labelled with the
 * segment's start–end. Mirrors buildSourceLinkHtml in api/src/lib/anki.ts (the
 * selfhost browser→AnkiConnect path builds the card HTML client-side). Returns
 * '' when there is no usable source URL.
 */
export function buildSourceLinkHtml(source: {
  sourceUrl?: string | null;
  startMs?: number | null;
  endMs?: number | null;
}): string {
  const raw = typeof source.sourceUrl === 'string' ? source.sourceUrl.trim() : '';
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const start = typeof source.startMs === 'number' && source.startMs >= 0 ? source.startMs : null;
  const end = typeof source.endMs === 'number' && source.endMs >= 0 ? source.endMs : null;
  if (start !== null) url.searchParams.set('t', `${Math.floor(start / 1000)}s`);
  const range =
    start !== null && end !== null
      ? `${formatClipTimestamp(start)}–${formatClipTimestamp(end)}`
      : start !== null
        ? formatClipTimestamp(start)
        : 'Source';
  return `<a href="${escapeHtmlAttr(url.toString())}">▶ ${range}</a>`;
}
