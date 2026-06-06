import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { lookupWord } from '../server/dictionary-db';

/**
 * Integration tests for the SQLite-backed Afrikaans dictionary.
 * Requires `data/dictionary-af.db` to exist — run
 *
 *     npx tsx scripts/build-dictionary.ts
 *
 * before running these tests. The path resolves lazily inside the module so
 * setting DATA_DIR before/after import doesn't matter.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');
}
const DB_PATH = path.join(process.env.DATA_DIR, 'dictionary-af.db');

describe('dictionary-db', () => {
  beforeAll(() => {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(
        `Dictionary database not found at ${DB_PATH}. ` +
          `Run \`npx tsx scripts/build-dictionary.ts\` first.`,
      );
    }
  });

  describe('exact match', () => {
    test('finds a top-frequency root word', () => {
      const entry = lookupWord('die');
      expect(entry).toBeDefined();
      expect(entry!.word).toBe('die');
      expect(entry!.lemmaInfo).toBeUndefined();
      // "die" is the #1 most common Afrikaans word — curated rank should be preserved
      expect(entry!.rank).toBe(1);
      expect(entry!.senses.length).toBeGreaterThan(0);
    });

    test('case-insensitive', () => {
      const entry = lookupWord('Die');
      expect(entry).toBeDefined();
      expect(entry!.word).toBe('die');
    });

    test('curated frequency rank survives kaikki merge', () => {
      const entry = lookupWord('en');
      expect(entry).toBeDefined();
      // "en" is rank 2 in dictionary-roots.json — must not be overwritten by kaikki
      expect(entry!.rank).toBe(2);
    });
  });

  describe('prefix derivation', () => {
    test('bedink found via be- prefix on dink (lemmaInfo populated)', () => {
      // "bedink" (to consider) is not a kaikki entry on its own — it's reached
      // by stripping the be- prefix and finding "dink" (to think) as the stem.
      const entry = lookupWord('bedink');
      expect(entry).toBeDefined();
      expect(entry!.lemmaInfo).toBeDefined();
      expect(entry!.lemmaInfo!.stem).toBe('dink');
      expect(entry!.lemmaInfo!.label).toBe('derived from');
      // Senses come from the stem
      expect(entry!.senses.length).toBeGreaterThan(0);
    });

    test('verstaan is its own first-class entry (richer dict beats prefix-only lookup)', () => {
      // Worth pinning: in the legacy JSON dict "verstaan" was reached via the
      // ver- prefix on "staan". Kaikki has "verstaan" as a standalone entry,
      // so we now serve it directly — no lemmaInfo, and we get multiple senses.
      const entry = lookupWord('verstaan');
      expect(entry).toBeDefined();
      expect(entry!.lemmaInfo).toBeUndefined();
      expect(entry!.senses.length).toBeGreaterThan(1);
    });
  });

  describe('suffix derivation', () => {
    test('katte resolves to the kat lemma', () => {
      const entry = lookupWord('katte');
      expect(entry).toBeDefined();
      // kaikki has a dedicated "katte" page whose only gloss is "plural of kat".
      // Either way the lookup must reach an entry that points back at "kat".
      const pointsAtKat = entry!.senses.some((s) => /kat\b/i.test(s.gloss))
        || entry!.lemmaInfo?.stem === 'kat';
      expect(pointsAtKat).toBe(true);
    });

    test('manne (plural of man) found via inflections table only', () => {
      // "manne" is in the inflections table but NOT in entries — so this test
      // pins the inflections-table lookup path (step 2).
      const entry = lookupWord('manne');
      expect(entry).toBeDefined();
      expect(entry!.lemmaInfo).toBeDefined();
      expect(entry!.lemmaInfo!.stem).toBe('man');
      expect(entry!.lemmaInfo!.label).toMatch(/form of/);
      const manGloss = entry!.senses.some((s) => /\bman\b|male|husband/i.test(s.gloss));
      expect(manGloss).toBe(true);
    });
  });

  describe('miss', () => {
    test('returns undefined for nonsense', () => {
      expect(lookupWord('xyzzyx')).toBeUndefined();
    });

    test('returns undefined for a word that does not appear anywhere', () => {
      expect(lookupWord('blargleblarg')).toBeUndefined();
    });
  });

  describe('multi-sense words', () => {
    test('pond exposes multiple senses (currency, weight)', () => {
      const entry = lookupWord('pond');
      expect(entry).toBeDefined();
      expect(entry!.senses.length).toBeGreaterThanOrEqual(2);
      const currency = entry!.senses.some((s) => /currency|pound/i.test(s.gloss));
      const weight = entry!.senses.some((s) => /weight/i.test(s.gloss));
      expect(currency).toBe(true);
      expect(weight).toBe(true);
    });

    test('word (to become) has more than one sense', () => {
      const entry = lookupWord('word');
      expect(entry).toBeDefined();
      expect(entry!.senses.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('schema fields', () => {
    test('exposes partOfSpeech on each sense', () => {
      const entry = lookupWord('staan');
      expect(entry).toBeDefined();
      for (const s of entry!.senses) {
        expect(typeof s.partOfSpeech).toBe('string');
        expect(typeof s.gloss).toBe('string');
        expect(s.gloss.length).toBeGreaterThan(0);
      }
    });

    test('returns ipa for words that have one in kaikki', () => {
      // "word" carries /vɔrt/ in the dump — we picked the first IPA value.
      const entry = lookupWord('word');
      expect(entry).toBeDefined();
      expect(entry!.ipa).toBeDefined();
      expect(entry!.ipa).toMatch(/[\[\/]/);
    });
  });
});
