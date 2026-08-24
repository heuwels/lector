import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DictInstallError,
  UNMANAGED_VERSION,
  adoptUnrecorded,
  installDictionary,
  isInstalled,
  readInstalledManifest,
  sweepPartFiles,
} from './dict-install';
import { reloadDictPins } from './dict-pins';

// A stub release server stands in for GitHub. The installer must verify what it
// downloads against the pin, so the test needs to control both halves.
const BODY = 'not really a sqlite file, but it hashes the same way';
const BODY_SHA = new Bun.CryptoHasher('sha256').update(BODY).digest('hex');

let dir: string;
let envFile: string;
let server: ReturnType<typeof Bun.serve>;
let served: string;
let requests = 0;

function writeManifest(sha: string) {
  writeFileSync(
    envFile,
    `DICT_LANGS="af"\nDICT_VERSION_AF=dict-af-test\nDICT_SHA256_AF=${sha}\n`,
  );
  reloadDictPins();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lector-dict-'));
  envFile = join(dir, 'dict.env');
  process.env.DICT_ENV_PATH = envFile;
  requests = 0;
  served = BODY;
  server = Bun.serve({
    port: 0,
    fetch(req) {
      requests += 1;
      if (new URL(req.url).pathname !== '/dict-af-test/dictionary-af.db') {
        return new Response('nope', { status: 404 });
      }
      return new Response(served);
    },
  });
  process.env.DICT_RELEASE_BASE = `http://localhost:${server.port}`;
  writeManifest(BODY_SHA);
});

afterEach(() => {
  server.stop(true);
  delete process.env.DICT_ENV_PATH;
  delete process.env.DICT_RELEASE_BASE;
  reloadDictPins();
  rmSync(dir, { recursive: true, force: true });
});

describe('installDictionary', () => {
  test('downloads, verifies, and records the pinned version', async () => {
    const entry = await installDictionary('af', { dir });

    expect(entry.version).toBe('dict-af-test');
    expect(readFileSync(join(dir, 'dictionary-af.db'), 'utf8')).toBe(BODY);
    expect(readInstalledManifest(dir).af).toMatchObject({
      version: 'dict-af-test',
      sha256: BODY_SHA,
    });
    expect(requests).toBe(1);
  });

  test('refuses an asset whose hash does not match the pin', async () => {
    served = 'a different database entirely';

    await expect(installDictionary('af', { dir })).rejects.toThrow(DictInstallError);
    // Nothing lands under the real name, so a reader never opens a bad file.
    expect(existsSync(join(dir, 'dictionary-af.db'))).toBe(false);
    expect(readInstalledManifest(dir).af).toBeUndefined();
  });

  test('leaves no partial file behind after a failure', async () => {
    served = 'wrong';
    await expect(installDictionary('af', { dir })).rejects.toThrow();
    expect(readdirSync(dir).filter((name) => name.includes('.part'))).toEqual([]);
  });

  test('refuses a language with no pin', async () => {
    await expect(installDictionary('de', { dir })).rejects.toThrow(/no pin in dict.env/);
  });

  test('reports a failed download rather than writing the error body', async () => {
    process.env.DICT_RELEASE_BASE = `http://localhost:${server.port}/wrong-path`;
    await expect(installDictionary('af', { dir })).rejects.toThrow(/returned 404/);
    expect(existsSync(join(dir, 'dictionary-af.db'))).toBe(false);
  });
});

describe('a download that stalls', () => {
  test('gives up rather than holding the reconcile loop open', async () => {
    // A socket that opens and never finishes. Without a timeout this hangs
    // forever, and every other language waits behind it.
    server.stop(true);
    server = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({ start() {} })),
    });
    process.env.DICT_RELEASE_BASE = `http://localhost:${server.port}`;
    process.env.DICT_TIMEOUT_MS = '250';

    await expect(installDictionary('af', { dir })).rejects.toThrow();
    expect(existsSync(join(dir, 'dictionary-af.db'))).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes('.part'))).toEqual([]);

    delete process.env.DICT_TIMEOUT_MS;
  });
});

describe('sweepPartFiles', () => {
  test('removes a part file a killed process left behind', () => {
    // The name carries a pid this process will never be, which is exactly the
    // case the per-process catch block cannot clean up.
    writeFileSync(join(dir, '.dictionary-af.db.99999.part'), 'half a download');
    writeFileSync(join(dir, 'dictionary-de.db'), 'a real one');

    expect(sweepPartFiles(dir)).toBe(1);
    expect(existsSync(join(dir, '.dictionary-af.db.99999.part'))).toBe(false);
    // It must not touch anything else in the directory.
    expect(existsSync(join(dir, 'dictionary-de.db'))).toBe(true);
  });

  test('is quiet when the directory does not exist', () => {
    expect(sweepPartFiles(join(dir, 'nope'))).toBe(0);
  });
});

describe('adoptUnrecorded', () => {
  const pins = { af: { version: 'dict-af-test', sha256: BODY_SHA } };

  test('records a file the manifest does not name', () => {
    // A `:full` image built before the bake stage wrote a manifest, or a file
    // dropped in by hand. Leaving it unrecorded froze it forever.
    writeFileSync(join(dir, 'dictionary-af.db'), BODY);

    expect(adoptUnrecorded(pins, dir)).toEqual(['af']);
    expect(readInstalledManifest(dir).af).toMatchObject({ version: 'dict-af-test' });
  });

  test('lets a later pin change replace an adopted file', () => {
    writeFileSync(join(dir, 'dictionary-af.db'), BODY);
    adoptUnrecorded(pins, dir);

    const newerPin = { version: 'dict-af-newer', sha256: BODY_SHA };
    expect(isInstalled('af', newerPin, readInstalledManifest(dir), dir)).toBe(false);
  });

  test('leaves a recorded file alone', async () => {
    await installDictionary('af', { dir });
    expect(adoptUnrecorded(pins, dir)).toEqual([]);
  });

  test('ignores a language with no file on disk', () => {
    expect(adoptUnrecorded(pins, dir)).toEqual([]);
  });
});

describe('isInstalled', () => {
  const pin = { version: 'dict-af-test', sha256: BODY_SHA };

  test('is false when the file is absent', () => {
    expect(isInstalled('af', pin, {}, dir)).toBe(false);
  });

  test('never replaces a file marked unmanaged', () => {
    // The DICT_URL build override writes this. It is somebody's own database.
    writeFileSync(join(dir, 'dictionary-af.db'), 'a custom dictionary');
    const manifest = { af: { version: UNMANAGED_VERSION, sha256: '', installedAt: '' } };
    expect(isInstalled('af', pin, manifest, dir)).toBe(true);
  });

  test('is true for a file the manifest records at the pinned version', async () => {
    await installDictionary('af', { dir });
    expect(isInstalled('af', pin, readInstalledManifest(dir), dir)).toBe(true);
  });

  test('is false when the manifest records an older version', async () => {
    await installDictionary('af', { dir });
    const manifest = readInstalledManifest(dir);
    manifest.af!.version = 'dict-af-older';
    expect(isInstalled('af', pin, manifest, dir)).toBe(false);
  });

  test('does not trust a file the manifest never recorded', () => {
    // adoptUnrecorded records it first, which is what keeps a `:full` image
    // from re-downloading 2.6 GB while still letting a pin change replace it.
    writeFileSync(join(dir, 'dictionary-af.db'), BODY);
    expect(isInstalled('af', pin, {}, dir)).toBe(false);
  });
});
