import { describe, test, expect } from 'bun:test';
import { parseLectorMode, assertBootableMode, config } from './config';

describe('parseLectorMode', () => {
  test('unset defaults to selfhost (back-compat: existing deployments set nothing)', () => {
    expect(parseLectorMode(undefined)).toBe('selfhost');
  });

  test('empty and whitespace-only default to selfhost', () => {
    expect(parseLectorMode('')).toBe('selfhost');
    expect(parseLectorMode('   ')).toBe('selfhost');
  });

  test('accepts the two known modes, tolerating surrounding whitespace', () => {
    expect(parseLectorMode('selfhost')).toBe('selfhost');
    expect(parseLectorMode('cloud')).toBe('cloud');
    expect(parseLectorMode(' cloud ')).toBe('cloud');
  });

  test('rejects unknown values instead of degrading to selfhost', () => {
    expect(() => parseLectorMode('banana')).toThrow(/Invalid LECTOR_MODE "banana"/);
    expect(() => parseLectorMode('banana')).toThrow(/selfhost, cloud/);
  });

  test('is case-sensitive — "Cloud" is a typo, not a mode', () => {
    expect(() => parseLectorMode('Cloud')).toThrow(/Invalid LECTOR_MODE/);
  });
});

describe('assertBootableMode', () => {
  test('selfhost boots', () => {
    expect(() => assertBootableMode('selfhost')).not.toThrow();
  });

  test('cloud is fail-closed until accounts ship (#218)', () => {
    expect(() => assertBootableMode('cloud')).toThrow(/not available yet/);
    expect(() => assertBootableMode('cloud')).toThrow(/#218/);
  });
});

describe('config singleton', () => {
  test('resolves to selfhost with auth not required under the test env', () => {
    // `bun run test` never sets LECTOR_MODE, so this pins the default shape.
    expect(config.mode).toBe('selfhost');
    expect(config.authRequired).toBe(false);
  });
});
