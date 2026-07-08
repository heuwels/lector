import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import { getTodayDate } from '../lib/dates';
import { LOCAL_USER_ID } from '../lib/user';

const { default: app } = await import('../routes/study-ping');

function reset() {
  db.prepare('DELETE FROM dailyStats').run();
  db.prepare("DELETE FROM settings WHERE key IN ('targetLanguage', 'timezone')").run();
}

function addStats(
  date: string,
  language: string,
  fields: {
    dictionaryLookups?: number;
    minutesRead?: number;
    clozePracticed?: number;
    sessionStartedAt?: string;
  },
) {
  db.prepare(
    `INSERT INTO dailyStats (date, language, dictionaryLookups, minutesRead, clozePracticed, sessionStartedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    date,
    language,
    fields.dictionaryLookups ?? 0,
    fields.minutesRead ?? 0,
    fields.clozePracticed ?? 0,
    fields.sessionStartedAt ?? null,
  );
}

describe('study-ping', () => {
  beforeEach(reset);
  afterEach(reset);

  test('GET aggregates activity across languages (app-wide), earliest session start', async () => {
    const today = getTodayDate(LOCAL_USER_ID);
    addStats(today, 'af', { dictionaryLookups: 3, minutesRead: 10, sessionStartedAt: '2026-06-21T09:00:00Z' });
    addStats(today, 'de', { dictionaryLookups: 2, clozePracticed: 4, sessionStartedAt: '2026-06-21T08:00:00Z' });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      done: boolean;
      lookups: number;
      minutes: number;
      clozePracticed: number;
      sessionStartedAt: string;
    };
    expect(data.done).toBe(true);
    expect(data.lookups).toBe(5); // 3 (af) + 2 (de) — would be one arbitrary row's value before the fix
    expect(data.minutes).toBe(10);
    expect(data.clozePracticed).toBe(4);
    expect(data.sessionStartedAt).toBe('2026-06-21T08:00:00Z'); // MIN across languages
  });

  test('GET reports no study when there are no rows for today', async () => {
    const res = await app.request('/');
    const data = (await res.json()) as { done: boolean; lookups: number };
    expect(data.done).toBe(false);
    expect(data.lookups).toBe(0);
  });

  test('POST records the session start on the active language row only', async () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'targetLanguage',
      JSON.stringify('de'),
    );
    const today = getTodayDate(LOCAL_USER_ID);

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);

    const rows = db
      .prepare('SELECT language, sessionStartedAt FROM dailyStats WHERE date = ?')
      .all(today) as { language: string; sessionStartedAt: string | null }[];
    expect(rows.length).toBe(1); // only the active language's row, not a blanket write
    expect(rows[0].language).toBe('de');
    expect(rows[0].sessionStartedAt).not.toBeNull();
  });
});
