import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import { db } from '../db';
import { getTodayDate } from '../lib/dates';
import { resolveLanguage } from '../lib/active-language';
import { recordStudySessionPing } from '../lib/study-session';
import { planLimitResponse } from '../lib/entitlements';

const app = new Hono();

interface DayActivity {
  dictionaryLookups: number;
  minutesRead: number;
  clozePracticed: number;
  sessionStartedAt: string | null;
}

// dailyStats has a compound (date, language) PK. "Did you study today" is an
// app-wide question, so aggregate every language's row for the date (matching
// the app-wide streak): SUM the activity and take the earliest session start.
// An aggregate over zero rows still returns one all-zero/NULL row.
function getDayActivity(userId: string, date: string): DayActivity {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(dictionaryLookups), 0) AS dictionaryLookups,
         COALESCE(SUM(minutesRead), 0)       AS minutesRead,
         COALESCE(SUM(clozePracticed), 0)    AS clozePracticed,
         MIN(sessionStartedAt)               AS sessionStartedAt
       FROM dailyStats WHERE userId = ? AND date = ?`,
    )
    .get(userId, date) as DayActivity;
}

// GET /api/study-ping
// Returns whether any language study happened today. Intended for the Sphere
// Guardian MCP to poll. Aggregated across languages (app-wide).
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const today = getTodayDate(userId);
  const activity = getDayActivity(userId, today);

  return c.json({
    done: activity.dictionaryLookups > 0 || activity.minutesRead > 0 || activity.clozePracticed > 0,
    date: today,
    minutes: activity.minutesRead,
    lookups: activity.dictionaryLookups,
    clozePracticed: activity.clozePracticed,
    sessionStartedAt: activity.sessionStartedAt,
  });
});

// POST /api/study-ping
// Called on the first word lookup or page turn of a session; records the session
// start time once per day, on the active language's row (compound PK).
app.post('/', (c) => {
  const userId = getCurrentUserId(c);
  const today = getTodayDate(userId);
  const lang = resolveLanguage(c.req.query('language'), userId);

  const verdict = recordStudySessionPing(userId, lang, today);
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  const activity = getDayActivity(userId, today);
  return c.json({
    done: true,
    date: today,
    minutes: activity.minutesRead,
    lookups: activity.dictionaryLookups,
    sessionStartedAt: activity.sessionStartedAt,
  });
});

export default app;
