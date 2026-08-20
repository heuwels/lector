import { describe, expect, it } from 'vitest';
import { getLanguageConfig } from '@/lib/languages';
import { readerBlockPropsEqual, type ReaderBlockProps } from './ReaderArticle';

const onWordClick = () => {};
const onActivateWord = () => {};
const onClearPhrase = () => {};

function props(overrides: Partial<ReaderBlockProps> = {}): ReaderBlockProps {
  return {
    as: 'p',
    children: 'Die son skyn.',
    blockId: 10,
    contentVersion: 'Die son skyn.',
    pack: getLanguageConfig('af'),
    // af is spaced, so it never carries a stored segmentation (#289 4.2).
    segmentation: null,
    knownWordsMap: new Map(),
    readings: null,
    annotationMode: 'off',
    highlightedPhrase: [],
    activeWord: null,
    onWordClick,
    onActivateWord,
    onClearPhrase,
    ...overrides,
  };
}

describe('readerBlockPropsEqual', () => {
  it('skips a block when another word changes state', () => {
    const previous = props({ knownWordsMap: new Map([['maan', 'new']]) });
    const next = props({ knownWordsMap: new Map([['maan', 'known']]) });

    expect(readerBlockPropsEqual(previous, next)).toBe(true);
  });

  it('re-renders a block when one of its words changes state', () => {
    const previous = props({ knownWordsMap: new Map([['son', 'new']]) });
    const next = props({ knownWordsMap: new Map([['son', 'known']]) });

    expect(readerBlockPropsEqual(previous, next)).toBe(false);
  });

  it('re-renders the block that gains the active-word highlight', () => {
    const previous = props();
    const next = props({ activeWord: { blockId: 10, wordIndex: 1 } });

    expect(readerBlockPropsEqual(previous, next)).toBe(false);
  });

  it('re-renders all blocks when the lesson text changes', () => {
    expect(readerBlockPropsEqual(props(), props({ contentVersion: 'Updated lesson' }))).toBe(false);
  });

  // Nothing else about a block changes with the annotation toggle, so if the
  // comparator ignores these two fields the toggle does nothing at all until an
  // unrelated prop moves (#289 4.4).
  it('re-renders every block when the annotation mode changes', () => {
    expect(readerBlockPropsEqual(props(), props({ annotationMode: 'all' }))).toBe(false);
  });

  it('re-renders every block when the readings arrive', () => {
    const readings = new Map([['son', 'sɔn']]);
    expect(readerBlockPropsEqual(props(), props({ readings }))).toBe(false);
  });
});
