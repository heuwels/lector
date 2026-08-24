/**
 * The negative cache is the trap in #438: `getDb` remembers "no dictionary for
 * this language" forever, so a dictionary that arrives after the first lookup
 * would stay invisible until a restart. That is the whole point of fetching at
 * runtime, so it gets its own test.
 *
 * The test builds a real, tiny SQLite dictionary and serves it from a stub
 * release server. Nothing here touches the network.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDictionary } from './dict-install';
import { reloadDictPins } from './dict-pins';
import { invalidateDictionaryCache, lookupWord } from './dictionary-db';

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let previousDictDir: string | undefined;

/** The columns dictionary-db.ts actually reads, and one Afrikaans word. */
function buildDictionary(file: string): ArrayBuffer {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE entries (word TEXT PRIMARY KEY, rank INTEGER, ipa TEXT, etymology TEXT);
    CREATE TABLE senses (word TEXT, pos TEXT, gloss TEXT, sort_order INTEGER);
    CREATE TABLE related_forms (word TEXT, related_word TEXT, relation TEXT);
    CREATE TABLE inflections (inflected_form TEXT, lemma TEXT, type TEXT);
    INSERT INTO entries (word, rank) VALUES ('huis', 1);
    INSERT INTO senses (word, pos, gloss, sort_order) VALUES ('huis', 'noun', 'A house.', 0);
  `);
  db.close();
  const bytes = readFileSync(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lector-hot-'));
  const source = buildDictionary(join(dir, 'source.db'));
  const sha = new Bun.CryptoHasher('sha256').update(source).digest('hex');

  const envFile = join(dir, 'dict.env');
  writeFileSync(envFile, `DICT_LANGS="af"\nDICT_VERSION_AF=dict-af-hot\nDICT_SHA256_AF=${sha}\n`);
  process.env.DICT_ENV_PATH = envFile;
  reloadDictPins();

  server = Bun.serve({ port: 0, fetch: () => new Response(source) });
  process.env.DICT_RELEASE_BASE = `http://localhost:${server.port}`;

  previousDictDir = process.env.DICT_DIR;
  // An empty directory, so the first lookup records the cached null.
  process.env.DICT_DIR = join(dir, 'installed');
  invalidateDictionaryCache('af');
});

afterEach(() => {
  server.stop(true);
  invalidateDictionaryCache('af');
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
  delete process.env.DICT_ENV_PATH;
  delete process.env.DICT_RELEASE_BASE;
  reloadDictPins();
  rmSync(dir, { recursive: true, force: true });
});

describe('a dictionary installed after the first lookup', () => {
  test('is visible without a restart', async () => {
    const dictDir = process.env.DICT_DIR!;

    // Miss first. This is what caches the null that used to be permanent.
    expect(await lookupWord('local', 'huis', 'af')).toBeFalsy();

    await installDictionary('af', { dir: dictDir });

    const hit = await lookupWord('local', 'huis', 'af');
    expect(hit?.word).toBe('huis');
    expect(hit?.senses[0]?.gloss).toBe('A house.');
    expect(hit?.source).toBe('dict');
  });
});
