import { describe, expect, it } from 'vitest';
import { lookupAnnouncement } from './lookup-announcement';

const base = { isOpen: true, word: 'son', isLoading: false, hasResult: false };

describe('lookupAnnouncement', () => {
  it('announces loading', () => {
    expect(lookupAnnouncement({ ...base, isLoading: true })).toBe('Looking up son.');
  });

  it('announces a loaded definition', () => {
    expect(lookupAnnouncement({ ...base, hasResult: true })).toBe('Definition loaded for son.');
  });

  it('announces lookup failures', () => {
    expect(lookupAnnouncement({ ...base, error: 'Try again.' })).toBe(
      'Lookup failed for son. Try again.',
    );
  });

  it('stays silent while the drawer is closed', () => {
    expect(lookupAnnouncement({ ...base, isOpen: false })).toBe('');
  });
});
