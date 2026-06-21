import { describe, it, expect } from 'vitest';
import { ankiCardToState, reconcileAnkiStates, findNewAnkiWords } from './anki';
import type { WordState } from '@/types';

describe('ankiCardToState', () => {
  it('New (type 0) → level1', () => {
    expect(ankiCardToState(0, 0)).toBe('level1');
  });

  it('Learning (type 1) → level2', () => {
    expect(ankiCardToState(1, 0)).toBe('level2');
  });

  it('Relearning (type 3) → level2', () => {
    expect(ankiCardToState(3, 0)).toBe('level2');
  });

  it('Young review (type 2, interval 1) → level3', () => {
    expect(ankiCardToState(2, 1)).toBe('level3');
  });

  it('Young review (type 2, interval 20) → level3', () => {
    expect(ankiCardToState(2, 20)).toBe('level3');
  });

  it('Mature boundary (type 2, interval 21) → known', () => {
    expect(ankiCardToState(2, 21)).toBe('known');
  });

  it('Mature (type 2, interval 100) → known', () => {
    expect(ankiCardToState(2, 100)).toBe('known');
  });
});

describe('reconcileAnkiStates', () => {
  const anki = (type: number, interval: number) => ({ type, interval });

  it('upgrades new → known when card is Mature', () => {
    const entries = [{ id: '1', text: 'hond', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['hond', anki(2, 25)]]));
    expect(updates).toEqual([{ id: '1', newState: 'known' }]);
  });

  it('upgrades new → level1 for a New card', () => {
    const entries = [{ id: '1', text: 'kat', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['kat', anki(0, 0)]]));
    expect(updates).toEqual([{ id: '1', newState: 'level1' }]);
  });

  it('upgrades new → level2 for a Learning card', () => {
    const entries = [{ id: '1', text: 'vis', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['vis', anki(1, 0)]]));
    expect(updates).toEqual([{ id: '1', newState: 'level2' }]);
  });

  it('upgrades new → level3 for a Young card', () => {
    const entries = [{ id: '1', text: 'boom', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['boom', anki(2, 10)]]));
    expect(updates).toEqual([{ id: '1', newState: 'level3' }]);
  });

  it('does not upgrade when current state already matches', () => {
    const entries = [{ id: '1', text: 'maan', state: 'level3' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['maan', anki(2, 10)]]));
    expect(updates).toHaveLength(0);
  });

  it('never demotes — known stays known when Anki also says known (Mature)', () => {
    const entries = [{ id: '1', text: 'son', state: 'known' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['son', anki(2, 25)]]));
    expect(updates).toHaveLength(0);
  });

  it('never demotes — level4 stays when Anki says Young (level3)', () => {
    const entries = [{ id: '1', text: 'see', state: 'level4' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['see', anki(2, 10)]]));
    expect(updates).toHaveLength(0);
  });

  it('skips ignored entries even when Anki has a Mature card', () => {
    const entries = [{ id: '1', text: 'grond', state: 'ignored' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['grond', anki(2, 100)]]));
    expect(updates).toHaveLength(0);
  });

  it('skips words absent from Anki', () => {
    const entries = [{ id: '1', text: 'veld', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map());
    expect(updates).toHaveLength(0);
  });

  it('matches case-insensitively', () => {
    const entries = [{ id: '1', text: 'Hond', state: 'new' as WordState }];
    const updates = reconcileAnkiStates(entries, new Map([['hond', anki(2, 25)]]));
    expect(updates).toEqual([{ id: '1', newState: 'known' }]);
  });

  it('handles multiple entries independently', () => {
    const entries = [
      { id: '1', text: 'a', state: 'new' as WordState },
      { id: '2', text: 'b', state: 'level3' as WordState },
      { id: '3', text: 'c', state: 'ignored' as WordState },
    ];
    const ankiStates = new Map([
      ['a', anki(2, 25)],  // Mature → known: upgrades new
      ['b', anki(2, 25)],  // Mature → known: upgrades level3
      ['c', anki(2, 25)],  // ignored: skipped
    ]);
    const updates = reconcileAnkiStates(entries, ankiStates);
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.id === '1')?.newState).toBe('known');
    expect(updates.find((u) => u.id === '2')?.newState).toBe('known');
    expect(updates.find((u) => u.id === '3')).toBeUndefined();
  });
});

describe('findNewAnkiWords', () => {
  const ankiWord = (type: number, interval: number) => ({
    type, interval, sentence: 'Die hond blaf.', translation: 'The dog barks.',
  });

  it('returns words in Anki that are absent from lector', () => {
    const existing = [{ text: 'kat' }];
    const ankiStates = new Map([
      ['kat', ankiWord(2, 25)],   // already in lector
      ['hond', ankiWord(2, 25)],  // not in lector
    ]);
    const result = findNewAnkiWords(existing, ankiStates);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hond');
    expect(result[0].state).toBe('known');
  });

  it('maps the Anki type to the correct state for new words', () => {
    const existing: { text: string }[] = [];
    const ankiStates = new Map([
      ['nuut', ankiWord(0, 0)],    // New → level1
      ['leer', ankiWord(1, 0)],    // Learning → level2
      ['jong', ankiWord(2, 10)],   // Young → level3
      ['ryp', ankiWord(2, 25)],    // Mature → known
    ]);
    const result = findNewAnkiWords(existing, ankiStates);
    expect(result.find((w) => w.text === 'nuut')?.state).toBe('level1');
    expect(result.find((w) => w.text === 'leer')?.state).toBe('level2');
    expect(result.find((w) => w.text === 'jong')?.state).toBe('level3');
    expect(result.find((w) => w.text === 'ryp')?.state).toBe('known');
  });

  it('returns empty when all Anki words already exist in lector', () => {
    const existing = [{ text: 'hond' }, { text: 'kat' }];
    const ankiStates = new Map([
      ['hond', ankiWord(2, 25)],
      ['kat', ankiWord(2, 30)],
    ]);
    expect(findNewAnkiWords(existing, ankiStates)).toHaveLength(0);
  });

  it('matches case-insensitively (existing entry "Hond" prevents import of "hond")', () => {
    const existing = [{ text: 'Hond' }];
    const ankiStates = new Map([['hond', ankiWord(2, 25)]]);
    expect(findNewAnkiWords(existing, ankiStates)).toHaveLength(0);
  });

  it('carries sentence and translation from the Anki card', () => {
    const existing: { text: string }[] = [];
    const ankiStates = new Map([
      ['boom', { type: 2, interval: 25, sentence: 'Die boom is groot.', translation: 'The tree is big.' }],
    ]);
    const result = findNewAnkiWords(existing, ankiStates);
    expect(result[0].sentence).toBe('Die boom is groot.');
    expect(result[0].translation).toBe('The tree is big.');
  });
});
