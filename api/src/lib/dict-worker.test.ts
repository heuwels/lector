import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reloadDictPins } from './dict-pins';
import {
  accountLanguages,
  dictStatuses,
  dictWorkerEnabled,
  missingLanguages,
  reconcileDictionaries,
  requestedLanguages,
  resetDictStatuses,
  wantedLanguages,
} from './dict-worker';

let dir: string;
let envFile: string;

// Only the settings table matters here: `enabledLanguages` (#442) is the signal
// that tells a self-host box which dictionaries it needs.
function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      userId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (userId, key)
    );
  `);
  return db;
}

function setSetting(db: Database, userId: string, key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
    userId,
    key,
    JSON.stringify(value),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lector-dictw-'));
  envFile = join(dir, 'dict.env');
  writeFileSync(
    envFile,
    [
      'DICT_LANGS="af de fr"',
      'DICT_VERSION_AF=dict-af-1',
      `DICT_SHA256_AF=${'a'.repeat(64)}`,
      'DICT_VERSION_DE=dict-de-1',
      `DICT_SHA256_DE=${'b'.repeat(64)}`,
      'DICT_VERSION_FR=dict-fr-1',
      `DICT_SHA256_FR=${'c'.repeat(64)}`,
      '',
    ].join('\n'),
  );
  process.env.DICT_ENV_PATH = envFile;
  delete process.env.DICT_LANGS;
  delete process.env.DICT_AUTO_INSTALL;
  delete process.env.DICT_FETCH;
  reloadDictPins();
});

afterEach(() => {
  delete process.env.DICT_ENV_PATH;
  delete process.env.DICT_LANGS;
  delete process.env.DICT_AUTO_INSTALL;
  delete process.env.DICT_FETCH;
  reloadDictPins();
  rmSync(dir, { recursive: true, force: true });
});

describe('requestedLanguages', () => {
  test('is empty when DICT_LANGS is unset', () => {
    expect(requestedLanguages(undefined)).toEqual([]);
  });

  test('expands `all` to every pinned language — what cloud sets', () => {
    expect(requestedLanguages('all')).toEqual(['af', 'de', 'fr']);
  });

  test('accepts a space or comma separated list', () => {
    expect(requestedLanguages('de, fr')).toEqual(['de', 'fr']);
    expect(requestedLanguages('DE fr')).toEqual(['de', 'fr']);
  });
});

describe('accountLanguages', () => {
  test('reads the opted-in list of every account', () => {
    const db = freshDb();
    setSetting(db, 'alice', 'enabledLanguages', ['de', 'fr']);
    setSetting(db, 'bob', 'enabledLanguages', ['af']);
    expect(accountLanguages(db).sort()).toEqual(['af', 'de', 'fr']);
  });

  test('picks up a learner who only has a target language', () => {
    // The #442 boot migration writes a list for these accounts, but the target
    // is read as well so a dictionary is never lost to a half-written pair.
    const db = freshDb();
    setSetting(db, 'carol', 'targetLanguage', 'de');
    expect(accountLanguages(db)).toEqual(['de']);
  });

  test('ignores unparseable or unknown values', () => {
    const db = freshDb();
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      'dave',
      'enabledLanguages',
      'not json',
    );
    setSetting(db, 'erin', 'enabledLanguages', ['zz']);
    expect(accountLanguages(db)).toEqual([]);
  });
});

describe('wantedLanguages', () => {
  test('unions DICT_LANGS with the opted-in languages', () => {
    const db = freshDb();
    setSetting(db, 'alice', 'enabledLanguages', ['fr']);
    process.env.DICT_LANGS = 'de';
    expect(wantedLanguages(db)).toEqual(['de', 'fr']);
  });

  test('covers a learner who never adds a language, on a box with no DICT_LANGS', () => {
    // The point of reading state instead of an add event: this account has been
    // studying German since before the opt-in picker existed.
    const db = freshDb();
    setSetting(db, 'old-timer', 'enabledLanguages', ['de']);
    expect(wantedLanguages(db)).toEqual(['de']);
  });

  test('DICT_AUTO_INSTALL=0 pins the box to DICT_LANGS alone', () => {
    const db = freshDb();
    setSetting(db, 'alice', 'enabledLanguages', ['fr']);
    process.env.DICT_LANGS = 'de';
    process.env.DICT_AUTO_INSTALL = '0';
    expect(wantedLanguages(db)).toEqual(['de']);
  });

  test('drops a language the manifest does not pin', () => {
    const db = freshDb();
    process.env.DICT_LANGS = 'de it';
    expect(wantedLanguages(db)).toEqual(['de']);
  });
});

describe('missingLanguages', () => {
  test('is the want-set minus what the manifest records', () => {
    const db = freshDb();
    process.env.DICT_LANGS = 'af de';
    writeFileSync(join(dir, 'dictionary-af.db'), 'x');
    writeFileSync(
      join(dir, 'installed.json'),
      JSON.stringify({ af: { version: 'dict-af-1', sha256: 'a'.repeat(64), installedAt: '' } }),
    );
    expect(missingLanguages(dir, db)).toEqual(['de']);
  });

  test('re-fetches a language whose pin moved on', () => {
    const db = freshDb();
    process.env.DICT_LANGS = 'af';
    writeFileSync(join(dir, 'dictionary-af.db'), 'x');
    writeFileSync(
      join(dir, 'installed.json'),
      JSON.stringify({ af: { version: 'dict-af-0', sha256: 'a'.repeat(64), installedAt: '' } }),
    );
    expect(missingLanguages(dir, db)).toEqual(['af']);
  });
});

describe('a language that fails to download', () => {
  let server: ReturnType<typeof Bun.serve>;
  let attempts = 0;

  beforeEach(() => {
    attempts = 0;
    server = Bun.serve({
      port: 0,
      fetch: () => {
        attempts += 1;
        return new Response('nope', { status: 500 });
      },
    });
    process.env.DICT_RELEASE_BASE = `http://localhost:${server.port}`;
    process.env.DICT_DIR = dir;
    process.env.DICT_LANGS = 'af';
    // Keep the real settings table out of it.
    process.env.DICT_AUTO_INSTALL = '0';
    resetDictStatuses();
  });

  afterEach(() => {
    server.stop(true);
    delete process.env.DICT_RELEASE_BASE;
    delete process.env.DICT_DIR;
    resetDictStatuses();
  });

  test('backs off instead of retrying every tick', async () => {
    const clock = 1_000_000;
    const now = () => clock;

    await reconcileDictionaries(undefined, now);
    expect(attempts).toBe(1);
    expect(dictStatuses()[0]).toMatchObject({ language: 'af', state: 'error', attempts: 1 });

    // The very next tick must not hammer the endpoint again.
    await reconcileDictionaries(undefined, now);
    expect(attempts).toBe(1);
  });

  test('retries for good once the backoff expires', async () => {
    let clock = 1_000_000;
    const now = () => clock;

    await reconcileDictionaries(undefined, now);
    expect(attempts).toBe(1);

    // A permanent give-up after three failures used to park the language on
    // the AI path for the life of the process. It must keep trying.
    for (let i = 0; i < 5; i += 1) {
      clock += 60 * 60 * 1000;
      await reconcileDictionaries(undefined, now);
    }
    expect(attempts).toBe(6);
    expect(dictStatuses()[0]!.attempts).toBe(6);
  });
});

describe('dictWorkerEnabled', () => {
  test('DICT_FETCH=0 turns the loop off', () => {
    process.env.DICT_FETCH = '0';
    expect(dictWorkerEnabled()).toBe(false);
  });

  test('DICT_FETCH=1 turns it on even under test', () => {
    process.env.DICT_FETCH = '1';
    expect(dictWorkerEnabled()).toBe(true);
  });

  test('a manifest with no pins leaves nothing to fetch', () => {
    writeFileSync(envFile, 'DICT_LANGS=""\n');
    reloadDictPins();
    process.env.DICT_FETCH = '1';
    expect(dictWorkerEnabled()).toBe(false);
  });
});
