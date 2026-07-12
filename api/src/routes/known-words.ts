import { Hono } from 'hono';
import { db, KnownWordRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { foldWord, getLanguageConfig } from '../lib/languages';
import { getCurrentUserId } from '../lib/user';
import { entitlements, planLimitResponse, type AtomicLimitCheck } from '../lib/entitlements';
import {
  aggregateGrowthCheck,
  batchGrowthCheck,
  growingRowCheck,
  utf8Bytes,
} from '../lib/storage-limits';
import { validateEnum, validateOptionalLanguage, validateWordKey } from '../lib/persisted-input';

const app = new Hono();
const WORD_STATES = new Set([
  'new',
  'level1',
  'level2',
  'level3',
  'level4',
  'known',
  'ignored',
] as const);

// GET /api/known-words - all known words as a word -> state map
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);

  const words = db
    .prepare('SELECT * FROM knownWords WHERE userId = ? AND language = ?')
    .all(userId, lang) as KnownWordRow[];
  const map: Record<string, string> = {};
  for (const w of words) {
    map[w.word] = w.state;
  }
  return c.json(map);
});

// POST /api/known-words - bulk update known words
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();

  if (!Array.isArray(body.updates)) {
    return c.json({ error: 'updates array required' }, 400);
  }
  const languageError = validateOptionalLanguage(body.language);
  if (languageError) return c.json({ error: languageError }, 400);

  const lang = resolveLanguage(body.language, userId);
  const pack = getLanguageConfig(lang);
  const normalized = new Map<string, string>();
  for (const update of body.updates as Array<{ word?: unknown; state?: unknown }>) {
    if (typeof update?.word !== 'string' || typeof update.state !== 'string') {
      return c.json({ error: 'Each update requires string word and state fields' }, 400);
    }
    const wordError = validateWordKey(update.word);
    if (wordError) return c.json({ error: wordError }, 400);
    const stateError = validateEnum(update.state, 'state', WORD_STATES, { optional: false });
    if (stateError) return c.json({ error: stateError }, 400);
    const word = foldWord(update.word, pack);
    const foldedError = validateWordKey(word);
    if (foldedError) return c.json({ error: foldedError }, 400);
    normalized.set(word, update.state);
  }

  const existing = new Set(
    (
      db
        .prepare('SELECT word FROM knownWords WHERE userId = ? AND language = ?')
        .all(userId, lang) as Array<{ word: string }>
    ).map((row) => row.word),
  );
  const newWords = [...normalized.keys()].filter((word) => !existing.has(word));
  const growthBytes = newWords.reduce((total, word) => total + utf8Bytes(word), 0);
  const largestWordBytes = newWords.reduce(
    (largest, word) => Math.max(largest, utf8Bytes(word)),
    0,
  );
  const checks: AtomicLimitCheck[] = [
    ...(newWords.length > 0
      ? [{ metric: 'maxKnownWords' as const, requested: newWords.length }]
      : []),
    ...growingRowCheck('maxKnownWordBytes', largestWordBytes),
    ...aggregateGrowthCheck('maxKnownWordsTextBytesTotal', growthBytes),
    ...batchGrowthCheck(growthBytes),
  ];

  const stmt = db.prepare(
    `INSERT INTO knownWords (userId, word, language, state) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, word, language) DO UPDATE SET state = excluded.state`,
  );
  const verdict = entitlements.reserveCount(userId, checks, () => {
    for (const [word, state] of normalized) {
      // Keys are folded (#289): NFC + per-script case fold, enforced
      // server-side so every client (UI, PAT, CLI) lands on the same key.
      stmt.run(userId, word, lang, state);
    }
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ success: true, count: body.updates.length });
});

export default app;
