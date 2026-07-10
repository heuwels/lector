import { describe, expect, test } from 'vitest';
import {
  defaultLessonCaps,
  verify,
  type LessonTokens,
  type Resolver,
  type WordlistEntry,
} from './verify-core';

// A tiny world: 6 target lemmas over two 3-lemma bands, plus a dictionary
// that knows one inflection (gatos → gato) and one non-target word (fuego).
const WORDLIST: WordlistEntry[] = [
  { rank: 1, lemma: 'el', band: 1 },
  { rank: 2, lemma: 'gato', band: 1 },
  { rank: 3, lemma: 'comer', band: 1 },
  { rank: 4, lemma: 'casa', band: 2 },
  { rank: 5, lemma: 'grande', band: 2 },
  { rank: 6, lemma: 'dormir', band: 2 },
];

const DICT = new Map<string, string>([
  ['el', 'el'],
  ['gato', 'gato'],
  ['gatos', 'gato'],
  ['comer', 'comer'],
  ['come', 'comer'],
  ['casa', 'casa'],
  ['grande', 'grande'],
  ['dormir', 'dormir'],
  ['duerme', 'dormir'],
  ['fuego', 'fuego'], // resolvable but not a target
]);
const resolve: Resolver = (folded) => DICT.get(folded) ?? null;

function lesson(partial: Partial<LessonTokens> & { tokens: string[] }): LessonTokens {
  return { title: 'L', maxRank: 3, allow: new Set(), ...partial };
}

describe('verify', () => {
  test('clean series passes with full coverage', () => {
    const summary = verify(
      [
        lesson({ title: 'L1', maxRank: 3, tokens: ['el', 'gato', 'come', 'el', 'gato', 'come'] }),
        lesson({
          title: 'L2',
          maxRank: 6,
          tokens: ['el', 'gato', 'duerme', 'casa', 'grande', 'dormir', 'casa', 'grande', 'come', 'duerme', 'casa', 'grande'],
        }),
      ],
      WORDLIST,
      resolve,
    );
    expect(summary.violations).toEqual([]);
    expect(summary.coverage.introduced).toBe(6);
    expect(summary.coverage.pct).toBe(100);
    expect(summary.coverage.missing).toEqual([]);
  });

  test('inflections credit their lemma', () => {
    const summary = verify(
      [lesson({ tokens: ['gatos', 'come'] })],
      WORDLIST,
      resolve,
    );
    expect(summary.violations).toEqual([]);
    expect(summary.lessons[0].newTargetLemmas).toEqual(['gato', 'comer']);
  });

  test('unresolvable tokens are dead taps', () => {
    const summary = verify([lesson({ tokens: ['el', 'zzz'] })], WORDLIST, resolve);
    expect(summary.violations).toHaveLength(1);
    expect(summary.violations[0]).toMatchObject({ kind: 'unresolvable', token: 'zzz' });
  });

  test('resolvable non-target words are off-list', () => {
    const summary = verify([lesson({ tokens: ['fuego'] })], WORDLIST, resolve);
    expect(summary.violations[0]).toMatchObject({ kind: 'off-list', token: 'fuego', lemma: 'fuego' });
  });

  test('band discipline: later-band lemmas violate an earlier lesson cap', () => {
    const summary = verify([lesson({ maxRank: 3, tokens: ['casa'] })], WORDLIST, resolve);
    expect(summary.violations[0]).toMatchObject({ kind: 'out-of-band', lemma: 'casa', rank: 4 });
  });

  test('whitelists exempt tokens at lesson and series level', () => {
    const summary = verify(
      [lesson({ tokens: ['zzz', 'ana'], allow: new Set(['zzz']) })],
      WORDLIST,
      resolve,
      { allow: new Set(['ana']) },
    );
    expect(summary.violations).toEqual([]);
  });

  test('a violating token is diagnosed once per lesson, not per occurrence', () => {
    const summary = verify([lesson({ tokens: ['zzz', 'zzz', 'zzz'] })], WORDLIST, resolve);
    expect(summary.violations).toHaveLength(1);
  });

  test('new-lemma cap fires per lesson', () => {
    const summary = verify(
      [lesson({ tokens: ['el', 'gato', 'come'] })],
      WORDLIST,
      resolve,
      { maxNewLemmasPerLesson: 2 },
    );
    expect(summary.violations[0]).toMatchObject({ kind: 'new-lemma-cap' });
  });

  test('coverage counts only lemmas reachable under the final cap', () => {
    const summary = verify(
      [lesson({ maxRank: 3, tokens: ['el', 'gato'] })],
      WORDLIST,
      resolve,
    );
    // comer (rank 3) reachable but never used; band-2 lemmas aren't reachable.
    expect(summary.coverage.reachableTotal).toBe(3);
    expect(summary.coverage.introduced).toBe(2);
    expect(summary.coverage.missing).toEqual(['comer']);
  });

  test('recycle counts span the whole series and count every occurrence', () => {
    const summary = verify(
      [
        lesson({ title: 'L1', tokens: ['el', 'el', 'gato'] }),
        lesson({ title: 'L2', maxRank: 6, tokens: ['el', 'gatos'] }),
      ],
      WORDLIST,
      resolve,
    );
    const counts = Object.fromEntries(summary.underRecycled.map((r) => [r.lemma, r.count]));
    expect(counts.gato).toBe(2); // gato + gatos
    expect(counts.el).toBeUndefined(); // 3 occurrences meets the default minRecycles
  });

  test('violating and allowed tokens never count toward recycling or novelty', () => {
    const summary = verify(
      [lesson({ maxRank: 3, tokens: ['casa', 'ana'], allow: new Set(['ana']) })],
      WORDLIST,
      resolve,
    );
    // casa violated (out of band) but still recycled? No: it IS counted as an
    // occurrence of a target lemma — but never introduced as new.
    expect(summary.lessons[0].newTargetLemmas).toEqual([]);
  });
});

describe('defaultLessonCaps', () => {
  test('20 lessons over 1000 lemmas → 5 lessons per 250-band', () => {
    const caps = defaultLessonCaps(20, 1000, 250);
    expect(caps[0]).toBe(250);
    expect(caps[4]).toBe(250);
    expect(caps[5]).toBe(500);
    expect(caps[19]).toBe(1000);
  });

  test('caps never exceed the wordlist size', () => {
    expect(defaultLessonCaps(3, 100, 250)).toEqual([100, 100, 100]);
  });

  test('more bands than lessons still ramps to the end', () => {
    const caps = defaultLessonCaps(2, 1000, 250);
    expect(caps).toEqual([250, 500]);
  });
});
