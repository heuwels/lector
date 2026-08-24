import { describe, test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseDictEnv, dictAssetUrl, dictEnvPath, reloadDictPins } from './dict-pins';

describe('parseDictEnv', () => {
  test('reads the published set and one pin per language', () => {
    const pins = parseDictEnv(`
# a comment
DICT_LANGS="af de"

# af
DICT_VERSION_AF=dict-af-2026-06-19
DICT_SHA256_AF=AABBCC

DICT_VERSION_DE=dict-de-2026-06-25
DICT_SHA256_DE=ddeeff
`);
    expect(pins.published).toEqual(['af', 'de']);
    expect(pins.pins.af).toEqual({ version: 'dict-af-2026-06-19', sha256: 'aabbcc' });
    expect(pins.pins.de!.version).toBe('dict-de-2026-06-25');
  });

  test('drops a listed language that has no pin', () => {
    const pins = parseDictEnv(`
DICT_LANGS="af zz"
DICT_VERSION_AF=dict-af-1
DICT_SHA256_AF=aa
`);
    expect(pins.published).toEqual(['af']);
    expect(pins.pins.zz).toBeUndefined();
  });

  test('ignores lines that are not assignments', () => {
    const pins = parseDictEnv(`
export FOO
DICT_LANGS='af'
DICT_VERSION_AF=v1
DICT_SHA256_AF=aa
`);
    expect(pins.published).toEqual(['af']);
  });

  test('the checked-in manifest parses and pins every published language', () => {
    const pins = parseDictEnv(readFileSync(dictEnvPath(), 'utf8'));
    expect(pins.published.length).toBeGreaterThan(0);
    for (const code of pins.published) {
      expect(pins.pins[code]!.version).toMatch(/^dict-/);
      expect(pins.pins[code]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('dictAssetUrl', () => {
  const original = process.env.DICT_RELEASE_BASE;
  afterEach(() => {
    if (original === undefined) delete process.env.DICT_RELEASE_BASE;
    else process.env.DICT_RELEASE_BASE = original;
    reloadDictPins();
  });

  test('builds the GitHub release URL by default', () => {
    delete process.env.DICT_RELEASE_BASE;
    expect(dictAssetUrl('de', { version: 'dict-de-1', sha256: 'aa' })).toBe(
      'https://github.com/heuwels/lector/releases/download/dict-de-1/dictionary-de.db',
    );
  });

  test('honours a mirror base and trims its trailing slash', () => {
    process.env.DICT_RELEASE_BASE = 'https://mirror.example.com/dicts/';
    expect(dictAssetUrl('af', { version: 'v1', sha256: 'aa' })).toBe(
      'https://mirror.example.com/dicts/v1/dictionary-af.db',
    );
  });
});
