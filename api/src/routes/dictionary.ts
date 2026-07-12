import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCurrentUserId } from '../lib/user';
import { db } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getTodayDate } from '../lib/dates';
import { recordStudySessionPing } from '../lib/study-session';
import {
  acceptedCacheContentBytes,
  acceptedCacheIdentity,
  cacheAcceptedEntry,
  lookupWord,
  storedAcceptedCacheContentBytes,
  validateCacheAcceptedInput,
} from '../lib/dictionary-db';
import { entitlements, planLimitResponse, type AtomicLimitCheck } from '../lib/entitlements';
import { aggregateGrowthCheck, batchGrowthCheck } from '../lib/storage-limits';

// The largest valid cache payload is well under this even with four-byte
// Unicode. Reject unknown/oversized fields before c.req.json() buffers them.
const MAX_CACHE_BODY_BYTES = 256 * 1024;

// Record an on-device dictionary hit: the shared session ping (sessionStartedAt
// on the looked-up language's row) plus a dictionaryLookups bump, so daily lookup
// stats stay accurate when the local DB serves a hit instead of the AI path. Both
// writes target the looked-up language's (date, language) row.
function recordDictionaryLookup(userId: string, language: string) {
  const today = getTodayDate(userId);
  const verdict = recordStudySessionPing(userId, language, today);
  if (!verdict.allowed) return;
  db.prepare(
    'UPDATE dailyStats SET dictionaryLookups = dictionaryLookups + 1 WHERE userId = ? AND date = ? AND language = ?',
  ).run(userId, today, language);
}

/** Route factory: production uses session identity; tests inject two tenants. */
export function makeDictionaryRoutes(
  resolveUser: (c: Parameters<typeof getCurrentUserId>[0]) => string = getCurrentUserId,
) {
  const app = new Hono();

  // GET /api/dictionary/lookup?word=<word>
  // Returns { entry } on a hit, { entry: null } on a miss (always 200 unless the
  // input is malformed). A miss signals the caller to fall back to AI translate.
  app.get('/lookup', (c) => {
    try {
      const word = c.req.query('word');
      if (!word || !word.trim()) {
        return c.json({ error: 'Word is required' }, 400);
      }

      const userId = resolveUser(c);
      const lang = resolveLanguage(c.req.query('language'), userId);
      const entry = lookupWord(userId, word.trim(), lang);
      if (entry) recordDictionaryLookup(userId, lang);

      return c.json({ entry: entry ?? null });
    } catch (error) {
      console.error('Dictionary lookup error:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, 500);
    }
  });

  // POST /api/dictionary/cache — persist a user-accepted AI translation.
  app.post(
    '/cache',
    bodyLimit({
      maxSize: MAX_CACHE_BODY_BYTES,
      onError: (c) => c.json({ error: 'Dictionary entry is too large' }, 413),
    }),
    async (c) => {
      try {
        const userId = resolveUser(c);
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json({ error: 'Malformed JSON body' }, 400);
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return c.json({ error: 'Dictionary entry must be an object' }, 400);
        }
        const record = body as Record<string, unknown>;
        if (record.language !== undefined && typeof record.language !== 'string') {
          return c.json({ error: 'Language must be a string' }, 400);
        }
        const language = resolveLanguage(record.language as string | undefined, userId);
        const validated = validateCacheAcceptedInput({ ...record, language });
        if (!validated.ok) return c.json({ error: validated.error }, 400);

        const identity = acceptedCacheIdentity(validated.value);
        const previousBytes = storedAcceptedCacheContentBytes(
          userId,
          identity.word,
          identity.language,
        );
        const nextBytes = acceptedCacheContentBytes(validated.value);
        const checks: AtomicLimitCheck[] = [
          ...(previousBytes === 0 ? [{ metric: 'maxAcceptedDictionaryEntries' as const }] : []),
          ...aggregateGrowthCheck('maxAcceptedDictionaryBytesTotal', nextBytes, previousBytes),
          ...batchGrowthCheck(Math.max(0, nextBytes - previousBytes)),
        ];
        let word: string | null = null;
        const verdict = entitlements.reserveCount(userId, checks, () => {
          word = cacheAcceptedEntry(userId, validated.value);
        });
        if (!verdict.allowed) return planLimitResponse(c, verdict);

        if (!word) {
          return c.json({ error: 'Nothing to cache' }, 400);
        }
        return c.json({ word });
      } catch (err) {
        console.error('Dictionary cache write error:', err);
        return c.json({ error: err instanceof Error ? err.message : 'Cache write failed' }, 500);
      }
    },
  );

  return app;
}

export default makeDictionaryRoutes();
