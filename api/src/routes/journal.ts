import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, JournalEntryRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
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

const app = new Hono();

const withParsedCorrections = (e: JournalEntryRow) => ({
  ...e,
  corrections: e.corrections ? JSON.parse(e.corrections) : null,
});

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
    return c.json(entries.map(withParsedCorrections));
  }

  const entries = db
    .prepare(
      'SELECT * FROM journal_entries WHERE userId = ? AND language = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    )
    .all(userId, lang, limit, offset) as JournalEntryRow[];

  return c.json(entries.map(withParsedCorrections));
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
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
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

  return c.json(withParsedCorrections(entry));
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

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = ?'];
  const values: SQLQueryBindings[] = [now];
  let grown = 0;
  let nextContentBytes = journalContentBytes(existing);

  if (body.body !== undefined) {
    updates.push('body = ?', 'wordCount = ?');
    const wordCount = body.body.trim().split(/\s+/).filter(Boolean).length;
    // Meter only GROWTH (#222): editing down and re-typing must not
    // double-charge the month's allowance. `existing.wordCount` was read above
    // in the same synchronous tick (no await since), so it can't be stale.
    grown = wordCount - existing.wordCount;
    nextContentBytes = journalContentBytes({ ...existing, body: body.body });
    values.push(body.body, wordCount);
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
    };
    reservation = null; // the provider call happened — the usage is earned

    const correctedBody = typeof data.correctedBody === 'string' ? data.correctedBody : null;
    const corrections = JSON.stringify(data.corrections ?? null);
    const previousContentBytes = journalContentBytes(entry);
    const nextContentBytes = journalContentBytes({
      body: entry.body,
      correctedBody,
      corrections,
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
         SET correctedBody = ?, corrections = ?, status = 'submitted', updatedAt = ?
         WHERE id = ? AND userId = ? AND language = ?`,
      ).run(correctedBody, corrections, now, id, userId, lang);
    });
    if (!storageVerdict.allowed) return planLimitResponse(c, storageVerdict);

    return c.json({ correctedBody, corrections: data.corrections });
  } catch (error) {
    if (reservation) entitlements.refund(reservation);
    console.error('Journal correction error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Correction failed' }, 500);
  }
});

export default app;
