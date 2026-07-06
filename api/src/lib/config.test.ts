import { describe, test, expect } from 'bun:test';
import { parseLectorMode, parseCloudGate, assertBootableMode, config } from './config';

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

describe('parseCloudGate', () => {
  test('unset/empty default to none', () => {
    expect(parseCloudGate(undefined)).toBe('none');
    expect(parseCloudGate('')).toBe('none');
    expect(parseCloudGate('  ')).toBe('none');
  });

  test('accepts external, tolerating surrounding whitespace', () => {
    expect(parseCloudGate('external')).toBe('external');
    expect(parseCloudGate(' external ')).toBe('external');
  });

  test('rejects unknown values instead of weakening the boot guard', () => {
    expect(() => parseCloudGate('cloudflare')).toThrow(/Invalid LECTOR_CLOUD_GATE "cloudflare"/);
    expect(() => parseCloudGate('External')).toThrow(/Invalid LECTOR_CLOUD_GATE/);
  });
});

describe('assertBootableMode', () => {
  test('selfhost boots, with or without a gate declared', () => {
    expect(() => assertBootableMode('selfhost', 'none')).not.toThrow();
    expect(() => assertBootableMode('selfhost', 'external')).not.toThrow();
  });

  test('cloud without a gate is fail-closed until accounts ship (#218)', () => {
    expect(() => assertBootableMode('cloud', 'none')).toThrow(/not available yet/);
    expect(() => assertBootableMode('cloud', 'none')).toThrow(/#218/);
    expect(() => assertBootableMode('cloud', 'none')).toThrow(/LECTOR_CLOUD_GATE=external/);
  });

  test('cloud behind a declared external gate boots (the canary shape)', () => {
    expect(() => assertBootableMode('cloud', 'external')).not.toThrow();
  });
});

describe('config singleton', () => {
  test('resolves to selfhost, no gate, auth not required under the test env', () => {
    // `bun run test` never sets LECTOR_MODE, so this pins the default shape.
    expect(config.mode).toBe('selfhost');
    expect(config.cloudGate).toBe('none');
    expect(config.authRequired).toBe(false);
  });
});
