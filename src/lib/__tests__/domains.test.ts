import { describe, it, expect } from 'vitest';
import {
  DOMAINS,
  DOMAIN_KEYS,
  GENERAL,
  isDomainKey,
  isClassifiedDomain,
  masteryScore,
  axisValue,
  bandFor,
  DEFAULT_CEIL,
  STATE_WEIGHT,
} from '../domains';

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
