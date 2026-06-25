import { describe, it, expect } from 'vitest';
import {
  isKnown,
  commitShort,
  commitUrl,
  formatBuildTime,
  relativeBuildAge,
} from '@/lib/build-info';

describe('isKnown', () => {
  it('treats the fallback sentinels as unknown', () => {
    expect(isKnown('unknown')).toBe(false);
    expect(isKnown('')).toBe(false);
  });

  it('treats real values as known', () => {
    expect(isKnown('v1.34.0')).toBe(true);
    expect(isKnown('master')).toBe(true);
  });
});

describe('commitShort', () => {
  it('abbreviates a full SHA to 7 chars', () => {
    expect(commitShort('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')).toBe('a1b2c3d');
  });

  it('passes through the fallback sentinels unchanged', () => {
    expect(commitShort('unknown')).toBe('unknown');
    expect(commitShort('')).toBe('');
  });
});

describe('commitUrl', () => {
  it('builds a GitHub commit URL for a real SHA', () => {
    expect(commitUrl('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')).toBe(
      'https://github.com/heuwels/lector/commit/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    );
  });

  it('accepts an abbreviated SHA', () => {
    expect(commitUrl('a1b2c3d')).toBe('https://github.com/heuwels/lector/commit/a1b2c3d');
  });

  it('honours a custom repo slug', () => {
    expect(commitUrl('a1b2c3d', 'someone/fork')).toBe(
      'https://github.com/someone/fork/commit/a1b2c3d',
    );
  });

  it('returns null for non-SHA values so the UI renders plain text', () => {
    expect(commitUrl('unknown')).toBeNull();
    expect(commitUrl('')).toBeNull();
    expect(commitUrl('v1.34.0')).toBeNull();
  });
});

describe('formatBuildTime', () => {
  it('formats an ISO timestamp as a UTC string', () => {
    expect(formatBuildTime('2026-06-25T18:10:00.000Z')).toBe('25 Jun 2026, 18:10 UTC');
  });

  it('returns an empty string for empty or invalid input', () => {
    expect(formatBuildTime('')).toBe('');
    expect(formatBuildTime('not-a-date')).toBe('');
  });
});

describe('relativeBuildAge', () => {
  const now = Date.parse('2026-06-25T18:00:00.000Z');

  it('describes a build a couple of hours old', () => {
    expect(relativeBuildAge('2026-06-25T16:00:00.000Z', now)).toBe('2 hours ago');
  });

  it('describes a build a few days old', () => {
    expect(relativeBuildAge('2026-06-22T18:00:00.000Z', now)).toBe('3 days ago');
  });

  it('uses "yesterday" via numeric:auto', () => {
    expect(relativeBuildAge('2026-06-24T18:00:00.000Z', now)).toBe('yesterday');
  });

  it('returns an empty string for empty or invalid input', () => {
    expect(relativeBuildAge('', now)).toBe('');
    expect(relativeBuildAge('not-a-date', now)).toBe('');
  });
});
