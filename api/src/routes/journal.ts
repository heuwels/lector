import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, JournalEntryRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { countTypedWords, getLanguageConfig } from '../lib/languages';
import { getCurrentUserId } from '../lib/user';
import { correctJournalText } from '../lib/journal-correct';
import {
  entitlements,
  planLimitResponse,
  type AtomicLimitCheck,
  type UsageReservation,
} from '../lib/entitlements';
import { randomUUID } from 'crypto';
import {
  aggregateGrowthCheck,
  batchGrowthCheck,
  growingRowCheck,
  journalContentBytes,
} from '../lib/storage-limits';
import { validateDateKey, validateOptionalLanguage } from '../lib/persisted-input';
import { getTodayDate } from '../lib/dates';

const app = new Hono();

const withParsedFields = (e: JournalEntryRow) => ({
  ...e,
  corrections: e.corrections ? JSON.parse(e.corrections) : null,
  critique: e.critique ? JSON.parse(e.critique) : null,
});

export type JournalCritique = {
  strengths: string[];
  weaknesses: string[];
};

export function parseCritique(raw: unknown): JournalCritique | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const strengths = Array.isArray(record.strengths)
    ? record.strengths.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      )
    : [];
  const weaknesses = Array.isArray(record.weaknesses)
    ? record.weaknesses.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      )
    : [];
  if (strengths.length === 0 && weaknesses.length === 0) return null;
  return { strengths, weaknesses };
}

// Month and year windows start from the learner's own calendar day, never UTC.
function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

// GET /api/journal - list entries, optionally filtered by date
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const date = c.req.query('date');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (date) {
    const entries = db
      .prepare(
        'SELECT * FROM journal_entries WHERE userId = ? AND entryDate = ? AND language = ? ORDER BY createdAt DESC',
      )
      .all(userId, date, lang) as JournalEntryRow[];
    return c.json(entries.map(withParsedFields));
  }

  const entries = db
    .prepare(
      'SELECT * FROM journal_entries WHERE userId = ? AND language = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    )
    .all(userId, lang, limit, offset) as JournalEntryRow[];

  return c.json(entries.map(withParsedFields));
});

// GET /api/journal/stats — word counts for submitted entries in the open language.
app.get('/stats', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const today = getTodayDate(userId);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entryDate >= ? THEN wordCount ELSE 0 END), 0) AS month
       , COALESCE(SUM(CASE WHEN entryDate >= ? THEN wordCount ELSE 0 END), 0) AS year
       , COALESCE(SUM(wordCount), 0) AS lifetime
       FROM journal_entries
       WHERE userId = ? AND language = ? AND status = 'submitted'`,
    )
    .get(monthStart(today), yearStart(today), userId, lang) as {
    month: number;
    year: number;
    lifetime: number;
  };

  return c.json({
    month: row.month,
    year: row.year,
    lifetime: row.lifetime,
  });
});

// POST /api/journal - create a new draft entry
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const { body, entryDate, language } = await c.req.json();
  if (body !== undefined && typeof body !== 'string') {
    return c.json({ error: 'body must be a string' }, 400);
  }
  const entryDateError = validateDateKey(entryDate, 'entryDate');
  if (entryDateError) return c.json({ error: entryDateError }, 400);
  const languageError = validateOptionalLanguage(language);
  if (languageError) return c.json({ error: languageError }, 400);
  const lang = resolveLanguage(language, userId);
  const date = entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const bodyText = body || '';
  const wordCount = countTypedWords(bodyText, getLanguageConfig(lang));
  const id = randomUUID();
  const contentBytes = journalContentBytes({ body: bodyText });
  const checks: AtomicLimitCheck[] = [
    { metric: 'maxJournalEntries' },
    ...(wordCount > 0 ? [{ metric: 'journalWordsPerMonth' as const, requested: wordCount }] : []),
    ...growingRowCheck('maxJournalEntryBytes', contentBytes),
    ...aggregateGrowthCheck('maxJournalTextBytesTotal', contentBytes),
    ...batchGrowthCheck(contentBytes),
  ];

  // Journal words / month (#222): check, insert, and meter in ONE transaction
  // so a failed insert never charges allowance and usage is never recorded
  // without the save landing (#222 review).
  const verdict = entitlements.reserveCount(userId, checks, () => {
    db.prepare(
      `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt, userId)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    ).run(id, bodyText, wordCount, date, lang, now, now, userId);
    if (wordCount > 0) entitlements.recordUsage(userId, 'journalWordsPerMonth', wordCount);
  });

  if (!verdict.allowed) return planLimitResponse(c, verdict);
  return c.json({ id, entryDate: date });
});

// GET /api/journal/:id
// By-id routes scope to the user + active language (defense-in-depth): a stale
// cross-language or cross-user id 404s rather than reading/mutating the entry.
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db
    .prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as JournalEntryRow | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  return c.json(withParsedFields(entry));
});

// PUT /api/journal/:id - update draft body
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const body = await c.req.json();

  if (body.body !== undefined && typeof body.body !== 'string') {
    return c.json({ error: 'body must be a string' }, 400);
  }

  const existing = db
    .prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as JournalEntryRow | undefined;
  if (!existing) return c.json({ error: 'Entry not found' }, 404);

  if (existing.status === 'submitted' && body.body !== undefined) {
    return c.json({ error: 'Cannot edit a submitted entry' }, 400);
  }

  if (body.status !== undefined && body.status !== 'draft' && body.status !== 'submitted') {
    return c.json({ error: 'status must be draft or submitted' }, 400);
  }
  if (body.status === 'draft' && existing.status === 'submitted') {
    return c.json({ error: 'Cannot reopen a submitted entry' }, 400);
  }
  if (body.revision !== undefined && typeof body.revision !== 'string') {
    return c.json({ error: 'revision must be a string' }, 400);
  }
  if (body.revision !== undefined) {
    if (existing.status !== 'submitted' && body.status !== 'submitted') {
      return c.json({ error: 'Save the entry before you add a revision' }, 400);
    }
    if (existing.corrections === null) {
      return c.json({ error: 'Ask for a correction before you add a revision' }, 400);
    }
  }

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = ?'];
  const values: SQLQueryBindings[] = [now];
  let grown = 0;
  let nextContentBytes = journalContentBytes(existing);

  if (body.body !== undefined) {
    updates.push('body = ?', 'wordCount = ?');
    const wordCount = countTypedWords(body.body, getLanguageConfig(lang));
    // Meter only GROWTH (#222): editing down and re-typing must not
    // double-charge the month's allowance. `existing.wordCount` was read above
    // in the same synchronous tick (no await since), so it can't be stale.
    grown = wordCount - existing.wordCount;
    nextContentBytes = journalContentBytes({ ...existing, body: body.body });
    values.push(body.body, wordCount);
  }

  if (body.status === 'submitted' && existing.status === 'draft') {
    updates.push("status = 'submitted'");
  }

  if (body.revision !== undefined) {
    updates.push('revision = ?');
    nextContentBytes = journalContentBytes({
      ...existing,
      body: body.body !== undefined ? body.body : existing.body,
      revision: body.revision,
    });
    values.push(body.revision);
  }

  values.push(id);
  values.push(userId);
  values.push(lang);

  // Persist and meter in ONE transaction so growth is charged only once the
  // UPDATE has actually landed — a failed update never burns allowance, and
  // the old code's record-before-write ordering is gone (#222 review).
  const previousContentBytes = journalContentBytes(existing);
  const checks: AtomicLimitCheck[] = [
    ...(grown > 0 ? [{ metric: 'journalWordsPerMonth' as const, requested: grown }] : []),
    ...growingRowCheck('maxJournalEntryBytes', nextContentBytes, previousContentBytes),
    ...aggregateGrowthCheck('maxJournalTextBytesTotal', nextContentBytes, previousContentBytes),
    ...batchGrowthCheck(Math.max(0, nextContentBytes - previousContentBytes)),
  ];
  const verdict = entitlements.reserveCount(userId, checks, () => {
    db.prepare(
      `UPDATE journal_entries SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`,
    ).run(...values);
    if (grown > 0) entitlements.recordUsage(userId, 'journalWordsPerMonth', grown);
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ success: true });
});

// DELETE /api/journal/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db
    .prepare('SELECT id FROM journal_entries WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang);

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  db.prepare('DELETE FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').run(
    id,
    userId,
    lang,
  );
  return c.json({ success: true });
});

// POST /api/journal/:id/correct — run the LLM correction on an entry and persist
// it (correctedBody + corrections, status → submitted).
app.post('/:id/correct', async (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db
    .prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as JournalEntryRow | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  if (!entry.body.trim()) return c.json({ error: 'Entry body is empty' }, 400);
  if (entry.corrections !== null) {
    return c.json({ error: 'Entry already has a correction' }, 400);
  }

  // Reserve the managed-LLM request before the provider call, refund on failure
  // (#222 review) — a check-then-record leaves a concurrent-request window.
  const llmVerdict = entitlements.reserve(userId, 'llmRequestsPerMonth');
  if (!llmVerdict.allowed) return planLimitResponse(c, llmVerdict);
  let reservation: UsageReservation | null = llmVerdict.reservation;

  try {
    const data = (await correctJournalText(userId, entry.body, entry.language, {
      byok: reservation.byok,
    })) as {
      correctedBody?: string;
      corrections?: unknown;
      critique?: unknown;
    };

    const correctedBody = typeof data.correctedBody === 'string' ? data.correctedBody : null;
    // A successful run always stores an array. null on the row means no run yet (#496).
    const correctionsList = Array.isArray(data.corrections) ? data.corrections : [];
    const corrections = JSON.stringify(correctionsList);
    const critique = parseCritique(data.critique);
    const critiqueJson = critique ? JSON.stringify(critique) : null;
    const previousContentBytes = journalContentBytes(entry);
    const nextContentBytes = journalContentBytes({
      body: entry.body,
      correctedBody,
      corrections,
      critique: critiqueJson,
    });
    const checks: AtomicLimitCheck[] = [
      ...growingRowCheck('maxJournalEntryBytes', nextContentBytes, previousContentBytes),
      ...aggregateGrowthCheck('maxJournalTextBytesTotal', nextContentBytes, previousContentBytes),
      ...batchGrowthCheck(Math.max(0, nextContentBytes - previousContentBytes)),
    ];
    const now = new Date().toISOString();
    const storageVerdict = entitlements.reserveCount(userId, checks, () => {
      db.prepare(
        `UPDATE journal_entries
         SET correctedBody = ?, corrections = ?, critique = ?, status = 'submitted', updatedAt = ?
         WHERE id = ? AND userId = ? AND language = ?`,
      ).run(correctedBody, corrections, critiqueJson, now, id, userId, lang);
    });
    if (!storageVerdict.allowed) {
      // A correction the learner cannot save is not useful consumption. Return
      // the reserved allowance just as we do when the provider call fails.
      entitlements.refund(reservation);
      reservation = null;
      return planLimitResponse(c, storageVerdict);
    }

    reservation = null; // provider output was persisted, so the usage is earned

    return c.json({ correctedBody, corrections: correctionsList, critique });
  } catch (error) {
    if (reservation) entitlements.refund(reservation);
    console.error('Journal correction error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Correction failed' }, 500);
  }
});

export default app;
