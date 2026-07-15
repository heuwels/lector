import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import { db, VocabRow, AnkiCardType, WordState } from '../db';
import { getActiveLanguageCode, resolveLanguage } from '../lib/active-language';
import { getTodayDate } from '../lib/dates';
import { foldWord, getLanguageConfig } from '../lib/languages';
import {
  ankiCardToState,
  buildClozeText,
  buildSourceLinkHtml,
  highlightWordHtml,
  splitTrailingPunctuation,
  stateRank,
} from '../lib/anki';
import {
  ANKI_PROTOCOL_CURRENT,
  ANKI_PROTOCOL_CURRENT_HEADER,
  ANKI_PROTOCOL_HEADER,
  ankiProtocolVerdict,
  downgradeAnkiResponse,
  parseAnkiProtocol,
  upgradeAnkiRequest,
} from '../lib/anki-protocol';
import { randomUUID } from 'crypto';
import { entitlements, planLimitResponse, type AtomicLimitCheck } from '../lib/entitlements';
import {
  aggregateGrowthCheck,
  ankiPendingContentBytes,
  batchGrowthCheck,
  growingRowCheck,
  utf8Bytes,
  vocabContentBytes,
} from '../lib/storage-limits';
import { reserveDailyStatsRows } from '../lib/daily-stats-limits';
import {
  validateDateKey,
  validateOptionalLanguage,
  validateSafeInteger,
  validateWordKey,
} from '../lib/persisted-input';

const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL || 'http://localhost:8765';

// SECURITY-04 (#241): the POST / proxy forwards to AnkiConnect, which exposes
// collection-wide power (importPackage, guiBrowse, multi, …). Only the actions
// lector itself performs may pass — everything else is refused server-side, so
// a scoped token or CSRF'd session can't drive arbitrary AnkiConnect actions
// through us.
const PROXY_ALLOWED_ACTIONS = new Set([
  'version',
  'deckNames',
  'createDeck',
  'addNote',
  'findCards',
  'cardsInfo',
  'sync',
  'getNumCardsReviewedByDay',
]);

async function ankiRequest(action: string, params?: Record<string, unknown>) {
  const res = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
    // Bound the call so a reachable-but-hung AnkiConnect can't stall the route
    // until the server idle timeout (matches sync-reviews' timeout).
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`AnkiConnect HTTP error: ${res.status}`);
  return res.json();
}

function triggerSync() {
  // Fire-and-forget — don't block the card-add response.
  ankiRequest('sync').catch((err) => console.error('[Anki] sync failed:', err));
}

const app = new Hono();

// GET /api/anki — connection check + deck list
app.get('/', async (c) => {
  try {
    const [versionRes, decksRes] = await Promise.all([
      ankiRequest('version'),
      ankiRequest('deckNames'),
    ]);
    return c.json({
      connected: true,
      version: versionRes.result,
      decks: decksRes.result ?? [],
    });
  } catch (err) {
    return c.json({
      connected: false,
      error: err instanceof Error ? err.message : 'Could not connect to Anki',
    });
  }
});

// POST /api/anki — proxy an allowlisted AnkiConnect action, auto-sync after addNote
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { action, params } = body as { action: string; params?: Record<string, unknown> };

    if (typeof action !== 'string' || !PROXY_ALLOWED_ACTIONS.has(action)) {
      return c.json(
        {
          result: null,
          error: `Action not allowed. Permitted: ${[...PROXY_ALLOWED_ACTIONS].join(', ')}`,
        },
        403,
      );
    }

    const result = await ankiRequest(action, params);

    if (action === 'addNote' && result.error === null) {
      triggerSync();
    }

    return c.json(result);
  } catch (err) {
    return c.json(
      { result: null, error: err instanceof Error ? err.message : 'AnkiConnect request failed' },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Addon endpoints (#241) — the server-side reversal. The browser never talks
// to AnkiConnect in cloud mode (Chrome's Local Network Access blocks public
// HTTPS origin → loopback); instead the app queues cards here and the Lector
// Anki addon, running on the user's machine, pulls the queue, creates notes
// with the structured Lector note types (LectorId field — no HTML parsing),
// acks them, and pushes review state back. Everything is tenant-scoped via
// getCurrentUserId; token access rides the anki:* scopes.
// ---------------------------------------------------------------------------

const CARD_TYPES: readonly AnkiCardType[] = ['basic', 'word', 'cloze'];
const ANKI_REVIEW_TYPES = new Set([0, 1, 2, 3]);
const MAX_QUEUE_ITEMS = 500;
const MAX_REVIEW_ITEMS = 10_000;
const MAX_REVIEW_DAYS = 3_660;

// Version handshake for the addon-facing endpoints (lib/anki-protocol.ts):
// resolve the addon's protocol, refuse below-minimum versions with a 426 the
// addon shows verbatim, advertise the server's current protocol on every
// response, and stash the version for the request/response transformers.
// /queue is excluded — it's called by the web app, not the addon.
const addonProtocol = async (c: import('hono').Context, next: () => Promise<void>) => {
  const version = parseAnkiProtocol(c.req.header(ANKI_PROTOCOL_HEADER));
  c.header(ANKI_PROTOCOL_CURRENT_HEADER, String(ANKI_PROTOCOL_CURRENT));
  const verdict = ankiProtocolVerdict(version);
  if (!verdict.ok) return c.json(verdict.body, verdict.status);
  c.set('ankiProtocol', version);
  await next();
};
app.use('/pending', addonProtocol);
app.use('/ack', addonProtocol);
app.use('/reviews', addonProtocol);

interface QueueItem {
  id: string;
  cardType: AnkiCardType;
  word?: string;
  sentence?: string;
  translation?: string;
  meaning?: string;
  // #334 — transcript provenance for the note's Source field.
  sourceUrl?: string;
  clipStartMs?: number;
  clipEndMs?: number;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// POST /api/anki/queue — enqueue vocab entries as pending Anki cards.
// word/sentence/translation/meaning override the vocab row's stored values
// (the reader's phrase-cloze picks a blank inside the phrase; practice queues
// the practice sentence). Re-queuing an entry replaces its pending row — the
// addon upserts by LectorId, so a repeat is an update, never a duplicate.
app.post('/queue', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json().catch(() => null);
  const items = (body as { items?: unknown })?.items;

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items must be a non-empty array' }, 400);
  }
  if (items.length > MAX_QUEUE_ITEMS) {
    return c.json({ error: `Too many items (max ${MAX_QUEUE_ITEMS})` }, 400);
  }

  const selectVocab = db.prepare('SELECT * FROM vocab WHERE id = ? AND userId = ?');
  // Re-queue = UPDATE with a version bump (never OR REPLACE): the version is
  // what lets /ack detect that its confirmation is stale (review P1 #2).
  const upsertPending = db.prepare(`
    INSERT INTO anki_pending (userId, vocabId, cardType, word, sentence, translation, meaning, sourceUrl, clipStartMs, clipEndMs, queuedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, vocabId, cardType) DO UPDATE SET
      word = excluded.word, sentence = excluded.sentence,
      translation = excluded.translation, meaning = excluded.meaning,
      sourceUrl = excluded.sourceUrl, clipStartMs = excluded.clipStartMs,
      clipEndMs = excluded.clipEndMs,
      queuedAt = excluded.queuedAt, version = anki_pending.version + 1
  `);

  let queued = 0;
  const failed: Array<{ id: string; error: string }> = [];
  const now = new Date().toISOString();
  type PlannedQueueWrite = {
    id: string;
    cardType: AnkiCardType;
    word: string | null;
    sentence: string | null;
    translation: string | null;
    meaning: string | null;
    sourceUrl: string | null;
    clipStartMs: number | null;
    clipEndMs: number | null;
  };
  const planned: PlannedQueueWrite[] = [];

  for (const raw of items as unknown[]) {
    const item = raw as QueueItem;
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || !CARD_TYPES.includes(item.cardType)) {
      failed.push({
        id: id || '(missing id)',
        error: 'Each item needs an id and a valid cardType',
      });
      continue;
    }
    const invalidOverride = (
      ['word', 'sentence', 'translation', 'meaning', 'sourceUrl'] as const
    ).find(
      (field) =>
        item[field] !== undefined && item[field] !== null && typeof item[field] !== 'string',
    );
    if (invalidOverride) {
      failed.push({ id, error: `${invalidOverride} must be a string` });
      continue;
    }
    const invalidClip = (['clipStartMs', 'clipEndMs'] as const).find(
      (field) =>
        item[field] !== undefined &&
        item[field] !== null &&
        (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field]! < 0),
    );
    if (invalidClip) {
      failed.push({ id, error: `${invalidClip} must be a non-negative number` });
      continue;
    }

    const vocab = selectVocab.get(id, userId) as VocabRow | undefined;
    if (!vocab) {
      failed.push({ id, error: 'Vocab entry not found' });
      continue;
    }

    const word = optionalString(item.word) ?? vocab.text;
    const sentence = optionalString(item.sentence) ?? vocab.sentence;

    // Validate clozes at queue time — a blank-less cloze is invalid in Anki,
    // so fail loudly here instead of letting the addon hit it later.
    if (item.cardType === 'cloze' && !buildClozeText(sentence, word).includes('{{c1::')) {
      failed.push({ id, error: `Could not build cloze: "${word}" not found in sentence` });
      continue;
    }

    planned.push({
      id,
      cardType: item.cardType,
      word: optionalString(item.word),
      sentence: optionalString(item.sentence),
      translation: optionalString(item.translation),
      meaning: optionalString(item.meaning),
      sourceUrl: optionalString(item.sourceUrl),
      clipStartMs: typeof item.clipStartMs === 'number' ? Math.floor(item.clipStartMs) : null,
      clipEndMs: typeof item.clipEndMs === 'number' ? Math.floor(item.clipEndMs) : null,
    });
  }

  const finalByKey = new Map(planned.map((item) => [`${item.id}\0${item.cardType}`, item]));
  const existing = new Map(
    (
      db
        .prepare(
          `SELECT vocabId, cardType, word, sentence, translation, meaning, sourceUrl
           FROM anki_pending WHERE userId = ?`,
        )
        .all(userId) as Array<{
        vocabId: string;
        cardType: AnkiCardType;
        word: string | null;
        sentence: string | null;
        translation: string | null;
        meaning: string | null;
        sourceUrl: string | null;
      }>
    ).map((row) => [`${row.vocabId}\0${row.cardType}`, row]),
  );
  let previousBytes = 0;
  let nextBytes = 0;
  let largestGrowingRow = 0;
  let netNew = 0;
  for (const [key, item] of finalByKey) {
    const before = existing.get(key);
    const beforeBytes = before ? ankiPendingContentBytes(before) : 0;
    const afterBytes = ankiPendingContentBytes(item);
    if (!before) netNew++;
    if (afterBytes > beforeBytes) largestGrowingRow = Math.max(largestGrowingRow, afterBytes);
    previousBytes += beforeBytes;
    nextBytes += afterBytes;
  }
  const growth = Math.max(0, nextBytes - previousBytes);
  const checks: AtomicLimitCheck[] = [
    ...(netNew > 0 ? [{ metric: 'maxAnkiPendingRows' as const, requested: netNew }] : []),
    ...growingRowCheck('maxAnkiPendingEntryBytes', largestGrowingRow),
    ...aggregateGrowthCheck('maxAnkiPendingTextBytesTotal', nextBytes, previousBytes),
    ...batchGrowthCheck(growth),
  ];
  const verdict = entitlements.reserveCount(userId, checks, () => {
    for (const item of planned) {
      upsertPending.run(
        userId,
        item.id,
        item.cardType,
        item.word,
        item.sentence,
        item.translation,
        item.meaning,
        item.sourceUrl,
        item.clipStartMs,
        item.clipEndMs,
        now,
      );
    }
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);
  queued = planned.length;

  return c.json({ queued, failed });
});

// GET /api/anki/pending — the addon's pull. Fields arrive render-ready
// (sentenceHtml bolded, clozeText blanked) so the addon fills note fields
// verbatim. Reading is idempotent; rows leave the queue only on ack. A row
// whose cloze no longer builds (the entry was edited after queueing) is
// dropped from the queue rather than served broken forever.
//
// Paginated (review P1 #1): at most MAX_QUEUE_ITEMS rows per call — the same
// ceiling /ack accepts, so one pulled batch is always fully ack-able. The
// addon drains the queue by looping pull→apply→ack while batches keep coming;
// `remaining` is advisory (for logs/progress).
app.get('/pending', (c) => {
  const userId = getCurrentUserId(c);

  const total = (
    db
      .prepare(
        `
    SELECT COUNT(*) AS n
    FROM anki_pending p
    JOIN vocab v ON v.userId = p.userId AND v.id = p.vocabId
    WHERE p.userId = ?
  `,
      )
      .get(userId) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `
    SELECT p.vocabId, p.cardType, p.word AS pWord, p.sentence AS pSentence,
           p.translation AS pTranslation, p.meaning AS pMeaning,
           p.sourceUrl, p.clipStartMs, p.clipEndMs, p.queuedAt, p.version,
           v.text, v.sentence, v.translation, v.language
    FROM anki_pending p
    JOIN vocab v ON v.userId = p.userId AND v.id = p.vocabId
    WHERE p.userId = ?
    ORDER BY p.queuedAt, p.vocabId
    LIMIT ${MAX_QUEUE_ITEMS}
  `,
    )
    .all(userId) as Array<{
    vocabId: string;
    cardType: AnkiCardType;
    pWord: string | null;
    pSentence: string | null;
    pTranslation: string | null;
    pMeaning: string | null;
    sourceUrl: string | null;
    clipStartMs: number | null;
    clipEndMs: number | null;
    queuedAt: string;
    version: number;
    text: string;
    sentence: string;
    translation: string;
    language: string;
  }>;

  const deleteRow = db.prepare(
    'DELETE FROM anki_pending WHERE userId = ? AND vocabId = ? AND cardType = ?',
  );

  const pending = [];
  for (const row of rows) {
    const [word] = splitTrailingPunctuation(row.pWord ?? row.text);
    const sentence = row.pSentence ?? row.sentence;
    const translation = row.pTranslation ?? row.translation;
    const meaning = row.pMeaning ?? translation;

    let clozeText = '';
    if (row.cardType === 'cloze') {
      clozeText = buildClozeText(sentence, word);
      if (!clozeText.includes('{{c1::')) {
        deleteRow.run(userId, row.vocabId, row.cardType);
        continue;
      }
    }

    pending.push({
      lectorId: row.vocabId,
      cardType: row.cardType,
      lang: row.language,
      word,
      sentence,
      sentenceHtml: row.cardType === 'basic' ? highlightWordHtml(sentence, word) : '',
      clozeText,
      translation,
      meaning,
      // #334 — render-ready Source anchor (empty for non-transcript cards). The
      // protocol-1 downgrade step strips this for addons that predate the field.
      source: buildSourceLinkHtml({
        sourceUrl: row.sourceUrl,
        clipStartMs: row.clipStartMs,
        clipEndMs: row.clipEndMs,
      }),
      queuedAt: row.queuedAt,
      version: row.version,
    });
  }

  return c.json(
    downgradeAnkiResponse(c.get('ankiProtocol'), '/pending', {
      pending,
      remaining: Math.max(0, total - rows.length),
    }),
  );
});

// POST /api/anki/ack — the addon confirms created/updated notes. Flips the
// entry's pushedToAnki + ankiNoteId (the same marks the browser path sets via
// PUT /api/vocab/:id) and clears the pending row. When the ack echoes the
// pulled row's `version`, the delete is conditional (version <= echoed) — a
// re-queue between pull and ack bumps the version, so the stale ack leaves
// the newer row in the queue for the next sync (review P1 #2).
app.post('/ack', async (c) => {
  const userId = getCurrentUserId(c);
  const body = upgradeAnkiRequest(
    c.get('ankiProtocol'),
    '/ack',
    await c.req.json().catch(() => null),
  );
  const results = (body as { results?: unknown })?.results;

  if (!Array.isArray(results) || results.length === 0) {
    return c.json({ error: 'results must be a non-empty array' }, 400);
  }
  if (results.length > MAX_QUEUE_ITEMS) {
    return c.json({ error: `Too many results (max ${MAX_QUEUE_ITEMS})` }, 400);
  }

  for (const [index, raw] of (results as unknown[]).entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return c.json({ error: `results[${index}] must be an object` }, 400);
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.lectorId !== 'string' || item.lectorId.length === 0) {
      return c.json({ error: `results[${index}].lectorId is required` }, 400);
    }
    const noteIdError = validateSafeInteger(item.noteId, `results[${index}].noteId`, {
      optional: false,
      min: 0,
    });
    if (noteIdError) return c.json({ error: noteIdError }, 400);
    if (item.cardType !== undefined && !CARD_TYPES.includes(item.cardType as AnkiCardType)) {
      return c.json({ error: `results[${index}].cardType is invalid` }, 400);
    }
    const versionError = validateSafeInteger(item.version, `results[${index}].version`, {
      min: 0,
    });
    if (versionError) return c.json({ error: versionError }, 400);
  }

  const markPushed = db.prepare(
    'UPDATE vocab SET pushedToAnki = 1, ankiNoteId = ? WHERE id = ? AND userId = ?',
  );
  const clearPendingUpTo = db.prepare(
    'DELETE FROM anki_pending WHERE userId = ? AND vocabId = ? AND cardType = ? AND version <= ?',
  );
  const clearPendingAny = db.prepare(
    'DELETE FROM anki_pending WHERE userId = ? AND vocabId = ? AND cardType = ?',
  );

  let acked = 0;
  db.transaction((items: unknown[]) => {
    for (const raw of items) {
      const item = raw as {
        lectorId?: unknown;
        cardType?: unknown;
        noteId?: unknown;
        version?: unknown;
      };
      const lectorId = typeof item.lectorId === 'string' ? item.lectorId : '';
      const noteId = item.noteId as number;

      const res = markPushed.run(noteId, lectorId, userId);
      if (CARD_TYPES.includes(item.cardType as AnkiCardType)) {
        const version =
          typeof item.version === 'number' && Number.isFinite(item.version)
            ? Math.trunc(item.version)
            : null;
        if (version === null) {
          clearPendingAny.run(userId, lectorId, item.cardType as string);
        } else {
          clearPendingUpTo.run(userId, lectorId, item.cardType as string, version);
        }
      }
      if (res.changes > 0) acked++;
    }
  })(results);

  return c.json(downgradeAnkiResponse(c.get('ankiProtocol'), '/ack', { acked }));
});

interface ReviewItem {
  lectorId?: string;
  word?: string;
  lang?: string;
  type: number;
  interval: number;
  noteId?: number;
  sentence?: string;
  translation?: string;
}

// POST /api/anki/reviews — structured review-state push from the addon: the
// server-side twin of the browser sync (reconcileAnkiStates + findNewAnkiWords
// in src/lib/anki.ts), minus the HTML archaeology — the addon reads LectorId/
// Word/Lang note fields and sends {type, interval} per card. Upgrade-only:
// never demotes, never touches `ignored`. Cards without a matching entry are
// imported (the addon only reports Lector note types, so these are real vocab).
// Optional reviewsByDay mirrors sync-reviews' dailyStats.ankiReviews upsert so
// the heatmap counts Anki study days without server→AnkiConnect access.
app.post('/reviews', async (c) => {
  const userId = getCurrentUserId(c);
  const body = upgradeAnkiRequest(
    c.get('ankiProtocol'),
    '/reviews',
    await c.req.json().catch(() => null),
  );
  const reviews = (body as { reviews?: unknown })?.reviews;
  const reviewsByDay = (body as { reviewsByDay?: unknown })?.reviewsByDay;

  if (!Array.isArray(reviews) && !Array.isArray(reviewsByDay)) {
    return c.json({ error: 'Provide reviews and/or reviewsByDay arrays' }, 400);
  }
  if (Array.isArray(reviews) && reviews.length > MAX_REVIEW_ITEMS) {
    return c.json({ error: `Too many reviews (max ${MAX_REVIEW_ITEMS})` }, 400);
  }
  if (Array.isArray(reviewsByDay) && reviewsByDay.length > MAX_REVIEW_DAYS) {
    return c.json({ error: `Too many reviewsByDay rows (max ${MAX_REVIEW_DAYS})` }, 400);
  }
  const reviewDays: Array<[string, number]> = [];
  if (Array.isArray(reviewsByDay)) {
    const normalized = new Map<string, number>();
    for (const [index, raw] of (reviewsByDay as unknown[]).entries()) {
      if (!Array.isArray(raw) || raw.length !== 2) {
        return c.json({ error: `reviewsByDay[${index}] must be a [date, count] pair` }, 400);
      }
      const dateError = validateDateKey(raw[0], `reviewsByDay[${index}].date`, {
        optional: false,
      });
      if (dateError) return c.json({ error: dateError }, 400);
      const countError = validateSafeInteger(raw[1], `reviewsByDay[${index}].count`, {
        optional: false,
        min: 0,
      });
      if (countError) return c.json({ error: countError }, 400);
      normalized.set(raw[0] as string, raw[1] as number);
    }
    reviewDays.push(...normalized);
  }
  if (reviewDays.length > 0) {
    const language = getActiveLanguageCode(userId);
    const preflight = reserveDailyStatsRows(
      userId,
      reviewDays.map(([date]) => ({ date, language })),
      () => {},
    );
    if (!preflight.allowed) return planLimitResponse(c, preflight);
  }

  let updated = 0;
  let created = 0;
  let unchanged = 0;

  if (Array.isArray(reviews) && reviews.length > 0) {
    // Dedupe by target first, keeping the highest-rank card — a word usually
    // has several cards (basic + cloze) and only the strongest signal counts
    // (same rule as the browser's syncWordStates).
    const best = new Map<string, { item: ReviewItem; state: WordState }>();
    for (const [index, raw] of (reviews as unknown[]).entries()) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return c.json({ error: `reviews[${index}] must be an object` }, 400);
      }
      const item = raw as ReviewItem;
      const typeError = validateSafeInteger(item.type, `reviews[${index}].type`, {
        optional: false,
        min: 0,
        max: 3,
      });
      if (typeError || !ANKI_REVIEW_TYPES.has(item.type)) {
        return c.json({ error: typeError ?? `reviews[${index}].type is invalid` }, 400);
      }
      const intervalError = validateSafeInteger(item.interval, `reviews[${index}].interval`, {
        optional: false,
      });
      if (intervalError) return c.json({ error: intervalError }, 400);
      const languageError = validateOptionalLanguage(item.lang, `reviews[${index}].lang`);
      if (languageError) return c.json({ error: languageError }, 400);
      if (item.lectorId !== undefined && typeof item.lectorId !== 'string') {
        return c.json({ error: `reviews[${index}].lectorId must be a string` }, 400);
      }
      if (item.word !== undefined) {
        const wordError = validateWordKey(item.word, `reviews[${index}].word`);
        if (wordError) return c.json({ error: wordError }, 400);
      }
      for (const field of ['sentence', 'translation'] as const) {
        if (item[field] !== undefined && typeof item[field] !== 'string') {
          return c.json({ error: `reviews[${index}].${field} must be a string` }, 400);
        }
      }
      const noteIdError = validateSafeInteger(item.noteId, `reviews[${index}].noteId`, {
        min: 0,
        nullable: true,
      });
      if (noteIdError) return c.json({ error: noteIdError }, 400);
      const state = ankiCardToState(item.type, item.interval);
      if (!state) continue; // New card → no learning signal

      const lang = resolveLanguage(typeof item.lang === 'string' ? item.lang : undefined, userId);
      const word = typeof item.word === 'string' ? item.word.trim() : '';
      const key =
        typeof item.lectorId === 'string' && item.lectorId
          ? `id:${item.lectorId}`
          : word
            ? `word:${lang}:${foldWord(word, getLanguageConfig(lang))}`
            : '';
      if (!key) continue;

      const existing = best.get(key);
      if (!existing || stateRank(state) > stateRank(existing.state)) {
        best.set(key, { item, state });
      }
    }

    // One vocab snapshot per call for the word-fallback resolution — folded
    // comparison happens in app code, never SQL LOWER() (#289).
    const allVocab = db
      .prepare('SELECT id, text, state, language FROM vocab WHERE userId = ?')
      .all(userId) as Array<Pick<VocabRow, 'id' | 'text' | 'state' | 'language'>>;
    const byId = new Map(allVocab.map((v) => [v.id, v]));
    const byWord = new Map<string, Pick<VocabRow, 'id' | 'text' | 'state' | 'language'>>();
    for (const v of allVocab) {
      byWord.set(
        `${v.language}:${foldWord(v.text, getLanguageConfig(resolveLanguage(v.language, userId)))}`,
        v,
      );
    }

    const now = new Date().toISOString();
    type PlannedReviewWrite =
      | { kind: 'update'; id: string; state: WordState; word: string; language: string }
      | {
          kind: 'create';
          id: string;
          state: WordState;
          word: string;
          language: string;
          sentence: string;
          translation: string;
          noteId: number | null;
        };
    const planned: PlannedReviewWrite[] = [];

    for (const { item, state } of best.values()) {
      const lang = resolveLanguage(typeof item.lang === 'string' ? item.lang : undefined, userId);
      const pack = getLanguageConfig(lang);
      const word = typeof item.word === 'string' ? item.word.trim() : '';
      const folded = word ? foldWord(word, pack) : '';

      const entry =
        (typeof item.lectorId === 'string' ? byId.get(item.lectorId) : undefined) ??
        (folded ? byWord.get(`${lang}:${folded}`) : undefined);

      if (entry) {
        if (entry.state === 'ignored' || stateRank(state) <= stateRank(entry.state)) {
          unchanged++;
          continue;
        }
        const entryLang = resolveLanguage(entry.language, userId);
        planned.push({
          kind: 'update',
          id: entry.id,
          state,
          word: foldWord(entry.text, getLanguageConfig(entryLang)),
          language: entryLang,
        });
        entry.state = state; // keep the planning snapshot honest for repeated targets
        continue;
      }

      if (!folded) {
        unchanged++;
        continue;
      }

      // Import: a studied Lector-note card with no matching entry (created
      // in Anki, or the entry was deleted here). Mirrors findNewAnkiWords.
      const noteId = typeof item.noteId === 'number' ? item.noteId : null;
      const id = randomUUID();
      const createdRow = {
        kind: 'create' as const,
        id,
        state,
        word: folded,
        language: lang,
        sentence: typeof item.sentence === 'string' ? item.sentence : '',
        translation: typeof item.translation === 'string' ? item.translation : '',
        noteId,
      };
      planned.push(createdRow);
      const importedRow = { id, text: folded, state, language: lang };
      byId.set(id, importedRow);
      byWord.set(`${lang}:${folded}`, importedRow);
    }

    const creates = planned.filter(
      (write): write is Extract<PlannedReviewWrite, { kind: 'create' }> => write.kind === 'create',
    );
    const knownExisting = new Set(
      (
        db.prepare('SELECT word, language FROM knownWords WHERE userId = ?').all(userId) as Array<{
          word: string;
          language: string;
        }>
      ).map((row) => `${row.language}:${row.word}`),
    );
    const plannedKnown = new Map<string, { word: string; language: string }>();
    for (const write of planned) {
      plannedKnown.set(`${write.language}:${write.word}`, {
        word: write.word,
        language: write.language,
      });
    }
    const newKnown = [...plannedKnown.entries()]
      .filter(([key]) => !knownExisting.has(key))
      .map(([, value]) => value);
    const vocabGrowth = creates.reduce(
      (total, write) =>
        total +
        vocabContentBytes({
          text: write.word,
          sentence: write.sentence,
          translation: write.translation,
        }),
      0,
    );
    const knownGrowth = newKnown.reduce((total, row) => total + utf8Bytes(row.word), 0);
    const largestVocab = creates.reduce(
      (largest, write) =>
        Math.max(
          largest,
          vocabContentBytes({
            text: write.word,
            sentence: write.sentence,
            translation: write.translation,
          }),
        ),
      0,
    );
    const largestKnown = newKnown.reduce(
      (largest, row) => Math.max(largest, utf8Bytes(row.word)),
      0,
    );
    const checks: AtomicLimitCheck[] = [
      ...(creates.length > 0
        ? [{ metric: 'maxVocabEntries' as const, requested: creates.length }]
        : []),
      ...growingRowCheck('maxVocabEntryBytes', largestVocab),
      ...aggregateGrowthCheck('maxVocabTextBytesTotal', vocabGrowth),
      ...(newKnown.length > 0
        ? [{ metric: 'maxKnownWords' as const, requested: newKnown.length }]
        : []),
      ...growingRowCheck('maxKnownWordBytes', largestKnown),
      ...aggregateGrowthCheck('maxKnownWordsTextBytesTotal', knownGrowth),
      ...batchGrowthCheck(vocabGrowth + knownGrowth),
    ];

    const updateState = db.prepare(
      'UPDATE vocab SET state = ?, stateUpdatedAt = ? WHERE id = ? AND userId = ?',
    );
    const upsertKnown = db.prepare(
      `INSERT INTO knownWords (userId, word, language, state) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, word, language) DO UPDATE SET state = excluded.state`,
    );
    const insertVocab = db.prepare(`
      INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId, language, userId)
      VALUES (?, ?, 'word', ?, ?, ?, ?, 0, NULL, NULL, ?, 1, ?, ?, ?)
    `);
    const verdict = entitlements.reserveCount(userId, checks, () => {
      for (const write of planned) {
        if (write.kind === 'update') {
          updateState.run(write.state, now, write.id, userId);
        } else {
          insertVocab.run(
            write.id,
            write.word,
            write.sentence,
            write.translation,
            write.state,
            now,
            now,
            write.noteId,
            write.language,
            userId,
          );
        }
        upsertKnown.run(userId, write.word, write.language, write.state);
      }
    });
    if (!verdict.allowed) return planLimitResponse(c, verdict);
    updated += planned.length - creates.length;
    created += creates.length;
  }

  let syncedDays = 0;
  if (reviewDays.length > 0) {
    const result = upsertAnkiReviewDays(userId, reviewDays);
    if (!result.verdict.allowed) return planLimitResponse(c, result.verdict);
    syncedDays = result.synced;
  }

  return c.json(
    downgradeAnkiResponse(c.get('ankiProtocol'), '/reviews', {
      updated,
      created,
      unchanged,
      syncedDays,
    }),
  );
});

// ---------------------------------------------------------------------------
// sync-reviews — settings-aware URL resolution + a guard timeout (mirrors the
// Next /api/anki/sync-reviews route, which deliberately differs from the simple
// GET/POST proxy above).
// ---------------------------------------------------------------------------

const DEFAULT_ANKI_CONNECT_URL = 'http://localhost:8765';
// A closed port (Anki not running) refuses instantly; this only bites the rare
// reachable-but-stuck case.
const ANKI_TIMEOUT_MS = 2500;

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Resolve the same way the browser client does: the ankiConnectUrl setting
// wins (remote Anki over Tailscale etc.), then the env var, then localhost.
// The setting is user-editable, so require an http(s) URL before fetch()ing it
// (rejects file:// and other schemes); localhost stays valid — AnkiConnect is a
// local service, so we don't block private addresses here.
function getAnkiConnectUrl(userId: string): string {
  try {
    const row = db
      .prepare('SELECT value FROM settings WHERE userId = ? AND key = ?')
      .get(userId, 'ankiConnectUrl') as { value: string } | undefined;
    const raw = row?.value?.replace(/^"|"$/g, '').trim();
    if (raw && isHttpUrl(raw)) return raw;
  } catch {
    // fall through to env / default
  }
  return process.env.ANKI_CONNECT_URL || DEFAULT_ANKI_CONNECT_URL;
}

async function ankiRequestWithUrl<T>(
  url: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(ANKI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const data = (await res.json()) as { result: T; error: string | null };
  if (data.error) throw new Error(data.error);
  return data.result;
}

/**
 * Upsert per-day Anki review counts into dailyStats.ankiReviews, touching ONLY
 * that column so the day's other counters are preserved. Shared by the
 * AnkiConnect pull below and the addon's push (POST /reviews). Counts are
 * attributed to the active language — Anki's per-day totals aren't
 * language-partitioned (same behaviour sync-reviews always had).
 */
function normalizeAnkiReviewDays(byDay: Array<[string, number]>): Array<[string, number]> {
  const normalized = new Map<string, number>();
  for (const row of byDay) {
    const [date, count] = Array.isArray(row) ? row : ['', NaN];
    if (validateDateKey(date, 'date', { optional: false })) continue;
    if (validateSafeInteger(count, 'count', { optional: false, min: 0 })) continue;
    normalized.set(date, count);
  }
  return [...normalized];
}

function upsertAnkiReviewDays(userId: string, byDay: Array<[string, number]>) {
  const language = getActiveLanguageCode(userId);
  const upsert = db.prepare(
    `INSERT INTO dailyStats (userId, date, language, ankiReviews) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, date, language) DO UPDATE SET ankiReviews = excluded.ankiReviews`,
  );
  const verdict = reserveDailyStatsRows(
    userId,
    byDay.map(([date]) => ({ date, language })),
    () => {
      for (const [date, count] of byDay) {
        upsert.run(userId, date, language, count);
      }
    },
  );
  return {
    synced: verdict.allowed ? byDay.length : 0,
    verdict,
  };
}

// POST /api/anki/sync-reviews — persist Anki's per-day review counts into
// dailyStats.ankiReviews so the heatmap/streak count Anki study days. Best-
// effort: an unreachable AnkiConnect leaves previously-synced data untouched.
app.post('/sync-reviews', async (c) => {
  const userId = getCurrentUserId(c);
  const url = getAnkiConnectUrl(userId);

  let byDay: Array<[string, number]>;
  try {
    byDay = await ankiRequestWithUrl<Array<[string, number]>>(url, 'getNumCardsReviewedByDay');
  } catch (err) {
    return c.json({
      connected: false,
      synced: 0,
      error: err instanceof Error ? err.message : 'Could not reach AnkiConnect',
    });
  }

  const normalized = normalizeAnkiReviewDays(byDay);
  const result = upsertAnkiReviewDays(userId, normalized);
  if (!result.verdict.allowed) return planLimitResponse(c, result.verdict);

  const reviewsToday = normalized.find(([d]) => d === getTodayDate(userId))?.[1] ?? 0;

  return c.json({ connected: true, synced: result.synced, reviewsToday });
});

export default app;
