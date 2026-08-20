import { describe, expect, it } from 'vitest';
import { ANNOTATION_MODES, wordReading, type AnnotationMode } from './annotation';

const readings = new Map([
  ['这', 'zhè'],
  ['喜欢', 'xǐhuan'],
]);

describe('wordReading', () => {
  it('prints nothing while the mode is off', () => {
    expect(wordReading('off', readings, '这', 'new')).toBeUndefined();
  });

  it('prints nothing when the language has no readings', () => {
    expect(wordReading('all', null, '这', 'new')).toBeUndefined();
  });

  it('prints every word in all mode', () => {
    expect(wordReading('all', readings, '这', 'known')).toBe('zhè');
    expect(wordReading('all', readings, '喜欢', undefined)).toBe('xǐhuan');
  });

  // The point of the feature: the reading disappears as the learner finishes
  // the word, so the annotation layer thins out on its own.
  it('drops a finished word in learning mode', () => {
    expect(wordReading('learning', readings, '这', 'known')).toBeUndefined();
    expect(wordReading('learning', readings, '这', 'ignored')).toBeUndefined();
  });

  it('keeps a word still being learned in learning mode', () => {
    expect(wordReading('learning', readings, '这', undefined)).toBe('zhè');
    expect(wordReading('learning', readings, '这', 'new')).toBe('zhè');
    expect(wordReading('learning', readings, '这', 'level4')).toBe('zhè');
  });

  it('prints nothing for a word the dictionary has no reading for', () => {
    expect(wordReading('all', readings, '书', 'new')).toBeUndefined();
  });

  // The toggle cycles by index, so a duplicate or a missing mode would either
  // skip a state or loop forever on one.
  it('cycles through each mode exactly once', () => {
    expect([...ANNOTATION_MODES]).toEqual<AnnotationMode[]>(['off', 'learning', 'all']);
    expect(new Set(ANNOTATION_MODES).size).toBe(ANNOTATION_MODES.length);
  });
});
