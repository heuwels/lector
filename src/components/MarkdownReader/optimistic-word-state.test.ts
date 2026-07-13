import { describe, expect, it } from 'vitest';
import { patchWordState } from './optimistic-word-state';

describe('patchWordState', () => {
  it('patches one word without changing the source map', () => {
    const source = new Map([['son', 'new' as const]]);
    const patch = patchWordState(source, 'son', 'known');

    expect(source.get('son')).toBe('new');
    expect(patch.map.get('son')).toBe('known');
  });

  it('restores the previous state after a failed write', () => {
    const patch = patchWordState(new Map([['son', 'level2' as const]]), 'son', 'ignored');

    expect(patch.rollback(patch.map).get('son')).toBe('level2');
  });

  it('removes a newly added state after a failed write', () => {
    const patch = patchWordState(new Map(), 'son', 'known');

    expect(patch.rollback(patch.map).has('son')).toBe(false);
  });

  it('does not let an older failure undo a newer choice', () => {
    const first = patchWordState(new Map(), 'son', 'level1');
    const second = patchWordState(first.map, 'son', 'level2');

    expect(first.rollback(second.map)).toBe(second.map);
    expect(first.rollback(second.map).get('son')).toBe('level2');
  });
});
