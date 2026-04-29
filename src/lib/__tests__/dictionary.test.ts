import { describe, test, expect } from 'vitest';
import { lookupWord } from '../dictionary';

describe('lookupWord — exact root match', () => {
  test('finds a root word', () => {
    const entry = lookupWord('die');
    expect(entry).toBeDefined();
    expect(entry!.word).toBe('die');
    expect(entry!.translation).toBe('the');
    expect(entry!.lemmaInfo).toBeUndefined();
  });

  test('case-insensitive', () => {
    const entry = lookupWord('Die');
    expect(entry).toBeDefined();
    expect(entry!.word).toBe('die');
  });
});

describe('lookupWord — known prefix derivation', () => {
  test('verstaan found via ver- prefix on staan', () => {
    const entry = lookupWord('verstaan');
    expect(entry).toBeDefined();
    expect(entry!.translation).toBe('understand');
    expect(entry!.lemmaInfo).toBeDefined();
    expect(entry!.lemmaInfo!.stem).toBe('staan');
  });

  test('gesien found via ge- prefix on sien', () => {
    const entry = lookupWord('gesien');
    expect(entry).toBeDefined();
    expect(entry!.translation).toBe('seen');
    expect(entry!.lemmaInfo!.stem).toBe('sien');
    expect(entry!.lemmaInfo!.label).toBe('past participle of');
  });

  test('verkoop found via ver- prefix on koop', () => {
    const entry = lookupWord('verkoop');
    expect(entry).toBeDefined();
    expect(entry!.translation).toBe('sell');
    expect(entry!.lemmaInfo!.stem).toBe('koop');
  });
});

describe('lookupWord — known suffix derivation', () => {
  test('werklik found via -lik suffix on werk', () => {
    const entry = lookupWord('werklik');
    expect(entry).toBeDefined();
    expect(entry!.translation).toBe('really');
    expect(entry!.lemmaInfo!.stem).toBe('werk');
  });

  test('liefde found via -de suffix on lief', () => {
    const entry = lookupWord('liefde');
    expect(entry).toBeDefined();
    expect(entry!.translation).toBe('love');
    expect(entry!.lemmaInfo!.stem).toBe('lief');
  });
});

describe('lookupWord — affix-strip fallback', () => {
  test('strips ge- prefix to find root when no nested entry exists', () => {
    // "gemaak" = ge- + maak (make), maak is a root but gemaak isn't a nested prefix entry
    const maak = lookupWord('maak');
    if (!maak) return;
    const entry = lookupWord('gemaak');
    expect(entry).toBeDefined();
    expect(entry!.lemmaInfo).toBeDefined();
    expect(entry!.lemmaInfo!.stem).toBe('maak');
    expect(entry!.lemmaInfo!.label).toBe('past participle of');
    // Fallback entries get rank 0
    expect(entry!.rank).toBe(0);
  });
});

describe('lookupWord — consonant undoubling', () => {
  test('katte → kat via -e suffix + undoubling', () => {
    const kat = lookupWord('kat');
    if (!kat) return;
    const entry = lookupWord('katte');
    expect(entry).toBeDefined();
    expect(entry!.lemmaInfo!.stem).toBe('kat');
  });
});

describe('lookupWord — no match', () => {
  test('returns undefined for unknown words', () => {
    expect(lookupWord('xyzzyx')).toBeUndefined();
  });

  test('exact root match takes priority over derivation', () => {
    // "het" is its own root, not ge- stripped from "et"
    const entry = lookupWord('het');
    expect(entry).toBeDefined();
    expect(entry!.lemmaInfo).toBeUndefined();
  });
});
