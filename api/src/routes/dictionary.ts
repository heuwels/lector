import { Hono } from 'hono';
import { db } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { lookupWord, cacheAcceptedEntry, type CacheAcceptedInput } from '../lib/dictionary-db';

const app = new Hono();

// Mirrors the recordStudyPing() side-effect from /api/translate, and also bumps
// dictionaryLookups so daily lookup stats stay accurate when the on-device DB
// serves a hit. Language-agnostic, matching the Next route.
function recordStudyPing() {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
  ).run(today);
  db.prepare('UPDATE dailyStats SET sessionStartedAt = COALESCE(sessionStartedAt, ?) WHERE date = ?').run(
    now,
    today,
  );
  db.prepare('UPDATE dailyStats SET dictionaryLookups = dictionaryLookups + 1 WHERE date = ?').run(today);
}

// GET /api/dictionary/lookup?word=<word>
// Returns { entry } on a hit, { entry: null } on a miss (always 200 unless the
// input is malformed). A miss signals the caller to fall back to AI translate.
app.get('/lookup', (c) => {
  try {
    const word = c.req.query('word');
    if (!word || !word.trim()) {
      return c.json({ error: 'Word is required' }, 400);
    }

    const lang = resolveLanguage(c.req.query('language'));
    const entry = lookupWord(word.trim(), lang);
    if (entry) recordStudyPing();

    return c.json({ entry: entry ?? null });
  } catch (error) {
    console.error('Dictionary lookup error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, 500);
  }
});

// POST /api/dictionary/cache — persist a user-accepted AI translation.
app.post('/cache', async (c) => {
  try {
    const body = (await c.req.json()) as Partial<CacheAcceptedInput>;
    if (!body.word || typeof body.word !== 'string' || !body.word.trim()) {
      return c.json({ error: 'Word is required' }, 400);
    }
    if (!Array.isArray(body.senses) || body.senses.length === 0) {
      return c.json({ error: 'At least one sense is required' }, 400);
    }

    const word = cacheAcceptedEntry({
      word: body.word,
      senses: body.senses,
      ipa: body.ipa,
      etymology: body.etymology,
      relatedForms: body.relatedForms,
      sourceSentence: body.sourceSentence,
      language: body.language,
    });

    if (!word) {
      return c.json({ error: 'Nothing to cache' }, 400);
    }
    return c.json({ word });
  } catch (err) {
    console.error('Dictionary cache write error:', err);
    return c.json({ error: err instanceof Error ? err.message : 'Cache write failed' }, 500);
  }
});

export default app;
