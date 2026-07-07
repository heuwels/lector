import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import { getTodayDate } from './dates';
import { recordStudySessionPing } from './study-session';

function reset() {
  db.prepare('DELETE FROM dailyStats').run();
  db.prepare("DELETE FROM settings WHERE key = 'timezone'").run();
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

  test('records the day in the configured time zone, not raw UTC', () => {
    const setTimeZone = (zone: string) =>
      db
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', ?)")
        .run(JSON.stringify(zone));

    // Two zones 25h apart always fall on different calendar days at any single
    // instant, so a timezone-aware writer records two distinct dates here while
    // the old raw-UTC writer would collapse both onto the one UTC day (1 row).
    setTimeZone('Pacific/Kiritimati'); // UTC+14
    recordStudySessionPing('af');
    setTimeZone('Pacific/Pago_Pago'); // UTC-11
    recordStudySessionPing('af');

    const dates = db
      .prepare("SELECT date FROM dailyStats WHERE language = 'af' ORDER BY date")
      .all() as { date: string }[];

    expect(dates.length).toBe(2);
    expect(dates[0].date).not.toBe(dates[1].date);
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
