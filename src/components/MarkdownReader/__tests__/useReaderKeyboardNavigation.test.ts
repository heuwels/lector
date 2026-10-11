import { describe, it, expect } from 'vitest';
import { parseWordElement, STATE_SHORTCUTS } from '../useReaderKeyboardNavigation';
import type { ActiveReaderWord } from '../ReaderArticle';

describe('STATE_SHORTCUTS', () => {
  it('maps digit keys to level states', () => {
    expect(STATE_SHORTCUTS['1']).toBe('level1');
    expect(STATE_SHORTCUTS['2']).toBe('level2');
    expect(STATE_SHORTCUTS['3']).toBe('level3');
    expect(STATE_SHORTCUTS['4']).toBe('level4');
  });

  it('maps k to known and x to ignored', () => {
    expect(STATE_SHORTCUTS['k']).toBe('known');
    expect(STATE_SHORTCUTS['x']).toBe('ignored');
    expect(STATE_SHORTCUTS['i']).toBe('ignored');
  });

  it('does not map non-shortcut keys', () => {
    expect(STATE_SHORTCUTS['s']).toBeUndefined();
    expect(STATE_SHORTCUTS['ArrowRight']).toBeUndefined();
    expect(STATE_SHORTCUTS['Escape']).toBeUndefined();
  });
});

describe('parseWordElement', () => {
  const makeElement = (
    attrs: Record<string, string | null>,
  ): { getAttribute: (name: string) => string | null } => ({
    getAttribute: (name: string) => attrs[name] ?? null,
  });

  it('extracts blockId and wordIndex from data attributes', () => {
    const el = makeElement({ 'data-block-id': '5', 'data-word-index': '3' });

    const result = parseWordElement(el);

    expect(result).toEqual({ blockId: 5, wordIndex: 3 });
  });

  it('returns null when data-block-id is missing', () => {
    const el = makeElement({ 'data-word-index': '0' });

    expect(parseWordElement(el)).toBeNull();
  });

  it('returns null when data-word-index is missing', () => {
    const el = makeElement({ 'data-block-id': '0' });

    expect(parseWordElement(el)).toBeNull();
  });

  it('parses zero values correctly', () => {
    const el = makeElement({ 'data-block-id': '0', 'data-word-index': '0' });

    const result = parseWordElement(el);
    expect(result).toEqual({ blockId: 0, wordIndex: 0 });
  });

  it('returns null when both attributes are missing', () => {
    const el = makeElement({});

    expect(parseWordElement(el)).toBeNull();
  });

  it('returns the correct type shape matching ActiveReaderWord', () => {
    const el = makeElement({ 'data-block-id': '3', 'data-word-index': '7' });
    const result: ActiveReaderWord | null = parseWordElement(el);
    expect(result).toEqual({ blockId: 3, wordIndex: 7 });
  });
});
