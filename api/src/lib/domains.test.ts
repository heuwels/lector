import { describe, it, expect } from 'bun:test';
import {
  DOMAINS,
  DOMAIN_KEYS,
  GENERAL,
  isDomainKey,
  isClassifiedDomain,
  masteryScore,
  axisValue,
  bandFor,
  deriveDomainFluency,
  DEFAULT_CEIL,
  STATE_WEIGHT,
  MASTERY_STATES,
  type DomainStateRow,
} from './domains';

describe('taxonomy', () => {
  it('has ~10 axes with unique keys', () => {
    expect(DOMAINS.length).toBe(10);
    expect(new Set(DOMAIN_KEYS).size).toBe(DOMAIN_KEYS.length);
  });

  it('every domain has a label and a non-empty scope hint for the classifier', () => {
    for (const d of DOMAINS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.scope.length).toBeGreaterThan(0);
    }
  });

  it('recognises domain keys but not general or junk', () => {
    expect(isDomainKey('food')).toBe(true);
    expect(isDomainKey(GENERAL)).toBe(false);
    expect(isDomainKey('nonsense')).toBe(false);
  });

  it('accepts every domain key and general as a classifier output', () => {
    for (const key of DOMAIN_KEYS) expect(isClassifiedDomain(key)).toBe(true);
    expect(isClassifiedDomain(GENERAL)).toBe(true);
    expect(isClassifiedDomain('nonsense')).toBe(false);
  });

  it('MASTERY_STATES is exactly the positively-weighted states (no new/ignored)', () => {
    const weighted: string[] = (Object.keys(STATE_WEIGHT) as (keyof typeof STATE_WEIGHT)[]).filter(
      (s) => STATE_WEIGHT[s] > 0,
    );
    expect(([...MASTERY_STATES] as string[]).sort()).toEqual(weighted.sort());
  });
});

describe('masteryScore — the "fraction of a word" model', () => {
  it('counts a known word as one full word', () => {
    expect(masteryScore({ known: 1 })).toBe(1);
    expect(masteryScore({ known: 10 })).toBe(10);
  });

  it('counts partially-learned words as fractions, new/ignored as zero', () => {
    expect(masteryScore({ level1: 1 })).toBeCloseTo(STATE_WEIGHT.level1);
    expect(masteryScore({ level4: 1 })).toBeCloseTo(STATE_WEIGHT.level4);
    expect(masteryScore({ new: 100, ignored: 100 })).toBe(0);
  });

  it('sums weighted contributions across states', () => {
    // 2 known + 4 level4 (0.5 each) + 10 level1 (0.05 each) = 2 + 2 + 0.5
    expect(masteryScore({ known: 2, level4: 4, level1: 10 })).toBeCloseTo(4.5);
  });

  it('is zero for an empty domain', () => {
    expect(masteryScore({})).toBe(0);
  });
});

describe('axisValue — log-normalised 0–100', () => {
  it('is 0 at zero or negative mastery', () => {
    expect(axisValue(0)).toBe(0);
    expect(axisValue(-5)).toBe(0);
  });

  it('reaches 100 when mastery hits the ceiling, and caps beyond it', () => {
    expect(axisValue(DEFAULT_CEIL)).toBe(100);
    expect(axisValue(DEFAULT_CEIL * 10)).toBe(100);
  });

  it('is monotonically non-decreasing in mastery', () => {
    let prev = -1;
    for (const m of [0, 1, 5, 10, 50, 100, 300, 600, 2000]) {
      const v = axisValue(m);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(100);
      prev = v;
    }
  });

  it('respects a custom (higher) ceiling — same mastery reads lower', () => {
    expect(axisValue(200, 3000)).toBeLessThan(axisValue(200, 600));
  });
});

describe('bandFor — neutral strength bands', () => {
  it('maps axis values to bands at the documented boundaries', () => {
    expect(bandFor(0)).toBe('Novice');
    expect(bandFor(19)).toBe('Novice');
    expect(bandFor(20)).toBe('Developing');
    expect(bandFor(44)).toBe('Developing');
    expect(bandFor(45)).toBe('Strong');
    expect(bandFor(74)).toBe('Strong');
    expect(bandFor(75)).toBe('Expert');
    expect(bandFor(100)).toBe('Expert');
  });
});

describe('deriveDomainFluency — folding grouped knownWords rows', () => {
  function axis(byDomain: ReturnType<typeof deriveDomainFluency>['byDomain'], key: string) {
    const a = byDomain.find((d) => d.domain === key);
    if (!a) throw new Error(`expected a '${key}' axis in byDomain`);
    return a;
  }

  it('aggregates per domain, excludes general, and reconciles known across axis/general/pending', () => {
    // The grouped rows the handler's `GROUP BY domain, state` would produce for a
    // single language. 'general' is classified but never an axis; null-domain
    // rows are unclassified (pending if in a mastery state).
    const rows: DomainStateRow[] = [
      { domain: 'food', state: 'known', count: 3 },
      { domain: 'health', state: 'known', count: 1 },
      { domain: 'health', state: 'level2', count: 1 },
      { domain: 'science_tech', state: 'known', count: 1 },
      { domain: 'general', state: 'known', count: 1 },
      { domain: null, state: 'known', count: 1 }, // pending (mastery state)
      { domain: null, state: 'level3', count: 1 }, // pending (mastery state)
      { domain: null, state: 'new', count: 1 }, // NOT pending — worker skips new
    ];

    const { byDomain, pending } = deriveDomainFluency(rows);

    expect(byDomain).toHaveLength(10); // fixed taxonomy → stable axes
    // (domain is typed as DomainKey so 'general' can't even appear — assert at runtime too)
    expect(byDomain.some((d) => (d.domain as string) === 'general')).toBe(false);

    expect(axis(byDomain, 'food').knownCount).toBe(3);
    expect(axis(byDomain, 'health').knownCount).toBe(1);
    expect(axis(byDomain, 'health').masteryScore).toBeCloseTo(1.15); // 1 known + 0.15 level2
    expect(axis(byDomain, 'science_tech').knownCount).toBe(1);

    const nature = axis(byDomain, 'nature');
    expect(nature.knownCount).toBe(0);
    expect(nature.axisValue).toBe(0);
    expect(nature.band).toBe('Novice');

    // pending = mastery-state rows with domain IS NULL (known + level3), excludes 'new'
    expect(pending).toBe(2);

    // Reconciliation invariant: every KNOWN word lands in exactly one of
    // {a domain axis, general, still-pending} — none dropped, none double-counted.
    const sumDomainKnown = byDomain.reduce((s, d) => s + d.knownCount, 0);
    const generalKnown = 1;
    const knownPending = 1;
    const totalKnown = 3 + 1 + 1 + 1 + 1; // every state==='known' row above
    expect(sumDomainKnown + generalKnown + knownPending).toBe(totalKnown);
    expect(totalKnown).toBe(7);
  });

  it('returns an all-zero radar (but non-zero pending) before anything is classified', () => {
    const rows: DomainStateRow[] = [
      { domain: null, state: 'known', count: 1 },
      { domain: null, state: 'level1', count: 1 },
    ];

    const { byDomain, pending } = deriveDomainFluency(rows);

    expect(byDomain).toHaveLength(10);
    expect(byDomain.every((d) => d.axisValue === 0 && d.knownCount === 0)).toBe(true);
    expect(pending).toBe(2); // both mastery-state + unclassified
  });

  it('does not count new/ignored unclassified words as pending', () => {
    const rows: DomainStateRow[] = [
      { domain: null, state: 'new', count: 5 },
      { domain: null, state: 'ignored', count: 3 },
    ];
    expect(deriveDomainFluency(rows).pending).toBe(0);
  });
});
