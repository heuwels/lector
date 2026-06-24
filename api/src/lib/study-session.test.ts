import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import { getTodayDate } from './dates';
import { recordStudySessionPing } from './study-session';

function reset() {
  db.prepare('DELETE FROM dailyStats').run();
}

describe('recordStudySessionPing', () => {
  beforeEach(reset);
  afterEach(reset);

  test("creates today's row for the given language and stamps sessionStartedAt", () => {
    recordStudySessionPing('de');

    const rows = db
      .prepare('SELECT date, language, sessionStartedAt FROM dailyStats')
      .all() as { date: string; language: string; sessionStartedAt: string | null }[];

    // The language-less bug created an 'af' row regardless of the active language;
    // the row must be for 'de', on the timezone-aware day boundary.
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe(getTodayDate());
    expect(rows[0].language).toBe('de');
    expect(rows[0].sessionStartedAt).not.toBeNull();
  });

  test('writes only the given language row — never a blanket cross-language write', () => {
    const today = getTodayDate();
    // A pre-existing 'af' session for the same day.
    db.prepare(
      "INSERT INTO dailyStats (date, language, sessionStartedAt) VALUES (?, 'af', ?)",
    ).run(today, '2026-06-21T06:00:00Z');

    recordStudySessionPing('de');

    const af = db
      .prepare("SELECT sessionStartedAt FROM dailyStats WHERE date = ? AND language = 'af'")
      .get(today) as { sessionStartedAt: string };
    const de = db
      .prepare("SELECT sessionStartedAt FROM dailyStats WHERE date = ? AND language = 'de'")
      .get(today) as { sessionStartedAt: string | null } | undefined;

    // 'af' is untouched, and a distinct 'de' row now exists (the old language-less
    // write only ever touched 'af' and would never create the 'de' row).
    expect(af.sessionStartedAt).toBe('2026-06-21T06:00:00Z');
    expect(de).toBeTruthy();
    expect(de!.sessionStartedAt).not.toBeNull();
  });

  test('is idempotent — a repeat ping keeps the earliest sessionStartedAt', () => {
    recordStudySessionPing('af');
    const today = getTodayDate();
    const first = db
      .prepare("SELECT sessionStartedAt FROM dailyStats WHERE date = ? AND language = 'af'")
      .get(today) as { sessionStartedAt: string };
    expect(first.sessionStartedAt).not.toBeNull();

    recordStudySessionPing('af');
    const second = db
      .prepare("SELECT sessionStartedAt FROM dailyStats WHERE date = ? AND language = 'af'")
      .get(today) as { sessionStartedAt: string };
    const count = db
      .prepare("SELECT COUNT(*) as n FROM dailyStats WHERE language = 'af'")
      .get() as { n: number };

    expect(second.sessionStartedAt).toBe(first.sessionStartedAt); // COALESCE keeps the first
    expect(count.n).toBe(1);
  });
});
