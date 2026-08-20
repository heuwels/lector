import { describe, it, expect } from 'vitest';
import { isComposing } from '../keyboard';

describe('isComposing (#289 4.5)', () => {
  it('is true while an IME is composing', () => {
    expect(isComposing({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('is true for the legacy keyCode 229 signal', () => {
    // Older IMEs and several Android keyboards report the composition keydown
    // as keyCode 229 with isComposing still false.
    expect(isComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('is false for an ordinary keypress', () => {
    expect(isComposing({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isComposing({ isComposing: false, keyCode: 49 })).toBe(false);
  });

  it('is false when neither field is present', () => {
    // React synthetic events and jsdom-constructed events may omit either.
    expect(isComposing({})).toBe(false);
  });
});
