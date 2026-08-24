import '../test-guard';
import { describe, test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  ANKI_WORD_THRESHOLD,
  LIFECYCLE_TEMPLATES,
  hasRealUse,
  languageLabel,
  notifyGlossCapHit,
  notifyVocabSaved,
  savedWordCount,
  sendWelcomeEmail,
  startLifecycleEmailWorker,
  stopLifecycleEmailWorker,
  sweepLifecycleEmails,
  type LifecycleDeps,
} from './lifecycle-email';
import type { EmailMessage } from './email';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function createSchema(): Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE email_sends (
      userId TEXT NOT NULL,
      templateAlias TEXT NOT NULL,
      sentAt TEXT NOT NULL,
      PRIMARY KEY (userId, templateAlias)
    );
    CREATE TABLE settings (
      userId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (userId, key)
    );
    CREATE TABLE vocab (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      text TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE learner_events (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      eventType TEXT NOT NULL
    );
    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      progress_percentComplete REAL NOT NULL DEFAULT 0,
      progress_scrollPosition INTEGER NOT NULL DEFAULT 0,
      lastReadAt TEXT
    );
  `);
  return database;
}

function insertUser(
  database: Database,
  opts: {
    id?: string;
    email?: string;
    name?: string | null;
    verified?: boolean;
    createdAt?: string;
  } = {},
): string {
  const id = opts.id ?? 'user-1';
  database
    .prepare(
      'INSERT INTO user (id, email, name, emailVerified, createdAt) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      id,
      opts.email ?? 'ada@example.com',
      opts.name === undefined ? 'Ada' : opts.name,
      opts.verified === false ? 0 : 1,
      opts.createdAt ?? '2026-08-25T00:00:00.000Z',
    );
  return id;
}

function insertWords(
  database: Database,
  userId: string,
  count: number,
  state = 'new',
  start = 0,
): void {
  for (let i = 0; i < count; i++) {
    const n = start + i;
    database
      .prepare('INSERT INTO vocab (id, userId, text, state) VALUES (?, ?, ?, ?)')
      .run(`${userId}-w${n}-${state}`, userId, `woord-${n}`, state);
  }
}

function sentAliases(database: Database, userId: string): string[] {
  return (
    database
      .prepare('SELECT templateAlias FROM email_sends WHERE userId = ? ORDER BY templateAlias')
      .all(userId) as { templateAlias: string }[]
  ).map((row) => row.templateAlias);
}

function deps(
  database: Database,
  inbox: EmailMessage[],
  extra: Partial<LifecycleDeps> = {},
): Partial<LifecycleDeps> {
  return {
    database,
    now: () => NOW,
    send: async (message) => {
      inbox.push(message);
    },
    cloud: true,
    hasResendKey: true,
    appUrl: 'https://app.lector.dev',
    ...extra,
  };
}

afterEach(() => {
  stopLifecycleEmailWorker();
});

describe('sendWelcomeEmail', () => {
  test('sends the welcome template once to a verified cloud user', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    database
      .prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)')
      .run(userId, 'targetLanguage', '"af"');

    expect(await sendWelcomeEmail(userId, deps(database, inbox))).toBe('sent');
    expect(await sendWelcomeEmail(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].template).toEqual({
      id: LIFECYCLE_TEMPLATES.welcome,
      variables: {
        USER_NAME: 'Ada',
        LANGUAGE: 'Afrikaans',
        APP_URL: 'https://app.lector.dev',
      },
    });
    expect(sentAliases(database, userId)).toEqual([LIFECYCLE_TEMPLATES.welcome]);
  });

  test('skips when the app is not cloud', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    expect(await sendWelcomeEmail(userId, deps(database, inbox, { cloud: false }))).toBe(
      'skipped',
    );
    expect(inbox).toHaveLength(0);
    expect(sentAliases(database, userId)).toEqual([]);
  });

  test('skips when RESEND_API_KEY is absent', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    expect(await sendWelcomeEmail(userId, deps(database, inbox, { hasResendKey: false }))).toBe(
      'skipped',
    );
    expect(inbox).toHaveLength(0);
  });

  test('skips an unverified user', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database, { verified: false });
    expect(await sendWelcomeEmail(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(0);
  });

  test('skips when the user table is absent', async () => {
    const database = new Database(':memory:');
    const inbox: EmailMessage[] = [];
    expect(await sendWelcomeEmail('user-1', deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(0);
  });

  test('a transport error does not throw and keeps the send row', async () => {
    const database = createSchema();
    const userId = insertUser(database);
    const result = await sendWelcomeEmail(
      userId,
      deps(database, [], {
        send: async () => {
          throw new Error('Resend down');
        },
      }),
    );
    expect(result).toBe('skipped');
    expect(sentAliases(database, userId)).toEqual([LIFECYCLE_TEMPLATES.welcome]);
  });
});

describe('notifyVocabSaved', () => {
  test('sends Anki at 10 saved words and not at 9', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    insertWords(database, userId, 9);
    expect(savedWordCount(database, userId)).toBe(9);
    expect(await notifyVocabSaved(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(0);

    insertWords(database, userId, 1, 'new', 9);
    expect(savedWordCount(database, userId)).toBe(ANKI_WORD_THRESHOLD);
    expect(await notifyVocabSaved(userId, deps(database, inbox))).toBe('sent');
    expect(await notifyVocabSaved(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].template?.id).toBe(LIFECYCLE_TEMPLATES.anki);
  });

  test('ignored words do not count toward the Anki threshold', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    insertWords(database, userId, 10, 'ignored');
    insertWords(database, userId, 9, 'new');
    expect(await notifyVocabSaved(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(0);
  });
});

describe('notifyGlossCapHit', () => {
  test('sends the free-tier gloss-cap template once', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database);
    expect(await notifyGlossCapHit(userId, deps(database, inbox))).toBe('sent');
    expect(await notifyGlossCapHit(userId, deps(database, inbox))).toBe('skipped');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].template?.id).toBe(LIFECYCLE_TEMPLATES.glossCap);
  });
});

describe('hasRealUse', () => {
  test('a starter lastReadAt with no progress is not real use', () => {
    const database = createSchema();
    const userId = insertUser(database);
    database
      .prepare(
        'INSERT INTO lessons (id, userId, progress_percentComplete, progress_scrollPosition, lastReadAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run('les-1', userId, 0, 0, '2026-08-25T00:00:00.000Z');
    expect(hasRealUse(database, userId)).toBe(false);
  });

  test('lesson progress or a learner event is real use', () => {
    const database = createSchema();
    const userId = insertUser(database, { id: 'user-progress' });
    database
      .prepare(
        'INSERT INTO lessons (id, userId, progress_percentComplete, progress_scrollPosition) VALUES (?, ?, ?, ?)',
      )
      .run('les-1', userId, 0.1, 0);
    expect(hasRealUse(database, userId)).toBe(true);

    const other = insertUser(database, { id: 'user-event', email: 'other@example.com' });
    database
      .prepare('INSERT INTO learner_events (id, userId, eventType) VALUES (?, ?, ?)')
      .run('evt-1', other, 'lesson.opened');
    expect(hasRealUse(database, other)).toBe(true);
  });
});

describe('sweepLifecycleEmails', () => {
  test('sends day-1 after 24 hours with no saved word', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database, {
      createdAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    const first = await sweepLifecycleEmails(deps(database, inbox));
    expect(first.sent).toBe(2);
    expect(inbox.map((m) => m.template?.id).sort()).toEqual([
      LIFECYCLE_TEMPLATES.day1,
      LIFECYCLE_TEMPLATES.welcome,
    ]);

    const second = await sweepLifecycleEmails(deps(database, inbox));
    expect(second.sent).toBe(0);
    expect(inbox).toHaveLength(2);
    expect(sentAliases(database, userId)).toEqual([
      LIFECYCLE_TEMPLATES.day1,
      LIFECYCLE_TEMPLATES.welcome,
    ]);
  });

  test('does not send day-1 before 24 hours', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    insertUser(database, { createdAt: new Date(NOW.getTime() - 23 * HOUR).toISOString() });
    await sweepLifecycleEmails(deps(database, inbox));
    expect(inbox.map((m) => m.template?.id)).toEqual([LIFECYCLE_TEMPLATES.welcome]);
  });

  test('does not send day-1 when a word is saved', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database, {
      createdAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    insertWords(database, userId, 1);
    await sweepLifecycleEmails(deps(database, inbox));
    expect(inbox.map((m) => m.template?.id)).toEqual([LIFECYCLE_TEMPLATES.welcome]);
  });

  test('sends day-3 after 72 hours with no real use', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database, {
      createdAt: new Date(NOW.getTime() - 73 * HOUR).toISOString(),
    });
    database
      .prepare(
        'INSERT INTO lessons (id, userId, progress_percentComplete, progress_scrollPosition, lastReadAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run('les-starter', userId, 0, 0, NOW.toISOString());
    await sweepLifecycleEmails(deps(database, inbox));
    expect(inbox.map((m) => m.template?.id).sort()).toEqual([
      LIFECYCLE_TEMPLATES.day1,
      LIFECYCLE_TEMPLATES.day3,
      LIFECYCLE_TEMPLATES.welcome,
    ]);
  });

  test('does not send day-3 when the user has real use', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    const userId = insertUser(database, {
      createdAt: new Date(NOW.getTime() - 73 * HOUR).toISOString(),
    });
    insertWords(database, userId, 1);
    await sweepLifecycleEmails(deps(database, inbox));
    expect(inbox.map((m) => m.template?.id)).toEqual([LIFECYCLE_TEMPLATES.welcome]);
  });

  test('skips the whole sweep when not cloud or the key is absent', async () => {
    const database = createSchema();
    const inbox: EmailMessage[] = [];
    insertUser(database, { createdAt: new Date(NOW.getTime() - 73 * HOUR).toISOString() });
    expect(await sweepLifecycleEmails(deps(database, inbox, { cloud: false }))).toEqual({
      sent: 0,
      skipped: 0,
    });
    expect(await sweepLifecycleEmails(deps(database, inbox, { hasResendKey: false }))).toEqual({
      sent: 0,
      skipped: 0,
    });
    expect(inbox).toHaveLength(0);
  });
});

describe('languageLabel', () => {
  test('reads the target language name and falls back', () => {
    const database = createSchema();
    const userId = insertUser(database);
    expect(languageLabel(database, userId)).toBe('your language');
    database
      .prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)')
      .run(userId, 'targetLanguage', '"af"');
    expect(languageLabel(database, userId)).toBe('Afrikaans');
  });
});

describe('startLifecycleEmailWorker', () => {
  test('does not boot in the selfhost test env', () => {
    expect(startLifecycleEmailWorker()).toBe(false);
  });
});
