import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DictInstallError,
  installDictionary,
  isInstalled,
  readInstalledManifest,
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

describe('isInstalled', () => {
  const pin = { version: 'dict-af-test', sha256: BODY_SHA };

  test('is false when the file is absent', () => {
    expect(isInstalled('af', pin, {}, dir)).toBe(false);
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

  test('leaves a baked file alone when the manifest says nothing', () => {
    // The `:full` image bakes databases and writes no manifest. Treating those
    // as missing would re-download every one of them on first boot.
    writeFileSync(join(dir, 'dictionary-af.db'), BODY);
    expect(isInstalled('af', pin, {}, dir)).toBe(true);
  });
});
