import { describe, expect, it } from 'vitest';
import { journalBadge } from './utils';

describe('journalBadge', () => {
  it('marks a draft as draft', () => {
    expect(journalBadge({ status: 'draft', corrections: null })).toBe('draft');
  });

  it('does not mark a submitted entry as perfect before a correction run', () => {
    expect(journalBadge({ status: 'submitted', corrections: null })).toBe('saved');
  });

  it('marks an empty correction list as perfect', () => {
    expect(journalBadge({ status: 'submitted', corrections: [] })).toBe('perfect');
  });

  it('marks a non-empty correction list as corrections', () => {
    expect(
      journalBadge({
        status: 'submitted',
        corrections: [
          {
            original: 'fout',
            corrected: 'reg',
            explanation: 'x',
            type: 'spelling',
          },
        ],
      }),
    ).toBe('corrections');
  });
});
