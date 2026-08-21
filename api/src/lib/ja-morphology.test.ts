import '../test-guard';
import { describe, expect, test } from 'bun:test';
import {
  analyseJapanese,
  japaneseAnalyserReady,
  katakanaToHiragana,
} from './ja-morphology';
import { buildSegmentWords } from './html-to-markdown';
import { getLanguageConfig } from './languages';

const ja = getLanguageConfig('ja');
const zh = getLanguageConfig('zh');

describe('Japanese morphological analysis (#214)', () => {
  // The analyser reaches into the pinned package's loader to read its dictionary
  // synchronously. If a version bump moves that path, this fails first and says
  // so, rather than every Japanese import silently dropping back to ICU.
  test('the analyser initialises', () => {
    expect(japaneseAnalyserReady()).toBe(true);
  });

  test('keeps a verb stem with its okurigana', () => {
    const surfaces = analyseJapanese('本を読んでいました')!.map((t) => t.surface);
    // ICU answers 読 | んで | いま | した here. Neither 読 nor んで is a word.
    expect(surfaces).toContain('読ん');
    expect(surfaces).not.toContain('読');
  });

  test('answers a dictionary form for an inflected verb', () => {
    const bySurface = new Map(analyseJapanese('食べられなかった')!.map((t) => [t.surface, t]));
    expect(bySurface.get('食べ')?.lemma).toBe('食べる');
    expect(bySurface.get('られ')?.lemma).toBe('られる');
  });

  // The reading no dictionary lookup can give. 本 is ホン in this sentence and
  // もと in the dictionary's standalone entry, and only context decides.
  test('reads a kanji in context', () => {
    const hon = analyseJapanese('本を読む')!.find((t) => t.surface === '本');
    expect(hon?.reading).toBe('ほん');
  });

  test('answers a reading in hiragana, not katakana', () => {
    const tokens = analyseJapanese('図書館')!;
    expect(tokens[0].reading).toBe('としょかん');
  });

  test('converts katakana to hiragana and leaves everything else alone', () => {
    expect(katakanaToHiragana('トショカン')).toBe('としょかん');
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー');
    expect(katakanaToHiragana('ABC123')).toBe('ABC123');
  });

  test('drops punctuation', () => {
    const surfaces = analyseJapanese('猫が、二匹います。')!.map((t) => t.surface);
    expect(surfaces).not.toContain('、');
    expect(surfaces).not.toContain('。');
  });
});

describe('buildSegmentWords with the analyser', () => {
  test('stores the analyser word list for Japanese', () => {
    const stored = JSON.parse(buildSegmentWords('本を読んでいました。', ja)!) as string[];
    // The list carries what the reader must keep whole. Single characters are
    // the longest-match fallback, so they stay out by design.
    expect(stored).toContain('読ん');
    expect(stored).not.toContain('読');
  });

  test('leaves Chinese on ICU', () => {
    const stored = JSON.parse(buildSegmentWords('我喜欢读书。', zh)!) as string[];
    expect(stored).toEqual(['喜欢', '读书']);
  });

  test('still answers null for a spaced pack', () => {
    expect(buildSegmentWords('Die hond loop.', getLanguageConfig('af'))).toBeNull();
  });

  // The reader replays the stored list with longest-match. A list that cannot
  // reproduce the analyser's own segmentation would draw spans the readings map
  // has no key for.
  test('the stored list replays the analyser segmentation', () => {
    const text = '父は東京で働いています。';
    const analysed = analyseJapanese(text)!.map((t) => t.surface);
    const stored = new Set(JSON.parse(buildSegmentWords(text, ja)!) as string[]);
    for (const surface of analysed) {
      if (surface.length > 1) expect(stored.has(surface)).toBe(true);
    }
  });
});
