import '../test-guard';
import { describe, test, expect } from 'bun:test';
import { buildSegmentWords } from './html-to-markdown';
import { getLanguageConfig, makeWordSegmentation, tokenizeWords } from './languages';
import type { LanguageConfig } from './languages';

// #289 4.2. The stored list is how a server-side quality segmenter reaches a
// browser that cannot run one. These tests pin the two properties the reader
// depends on: spaced packs never get a list, and a list the server writes
// reproduces the server's own segmentation when the client replays it.

function cjkPack(bcp47: string): LanguageConfig {
  return {
    ...getLanguageConfig('af'),
    script: {
      bcp47,
      direction: 'ltr',
      kind: 'cjk-unspaced',
      hasCase: false,
      sentenceTerminators: '。．！？!?',
    },
  } as LanguageConfig;
}

const zh = cjkPack('zh-Hans');
const ja = cjkPack('ja');

describe('buildSegmentWords', () => {
  test('returns null for every spaced pack, so the column stays empty', () => {
    for (const code of ['af', 'de', 'es', 'fr', 'ru', 'grc', 'tr', 'uk', 'pl', 'cs'] as const) {
      expect(buildSegmentWords('Die hond is groot.', getLanguageConfig(code))).toBeNull();
    }
  });

  test('returns null with no pack at all', () => {
    expect(buildSegmentWords('Die hond is groot.', undefined)).toBeNull();
  });

  test('stores multi-character forms for Chinese', () => {
    const stored = buildSegmentWords('我喜欢读书。', zh);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(['喜欢', '读书']);
  });

  test('omits single characters, which longest-match already handles', () => {
    // 我 is one character: storing it would bloat the list for zero benefit,
    // because an uncovered character falls back to a single-char token anyway.
    const stored = JSON.parse(buildSegmentWords('我喜欢读书。', zh)!) as string[];
    expect(stored).not.toContain('我');
    expect(stored.every((word) => word.length > 1)).toBe(true);
  });

  test('de-duplicates, so size tracks vocabulary and not length', () => {
    const once = JSON.parse(buildSegmentWords('我喜欢读书。', zh)!) as string[];
    const thrice = JSON.parse(
      buildSegmentWords('我喜欢读书。我喜欢读书。我喜欢读书。', zh)!,
    ) as string[];
    expect(thrice).toEqual(once);
  });

  test('returns null when a CJK pack finds no multi-character form', () => {
    expect(buildSegmentWords('。！？', zh)).toBeNull();
  });

  test('the stored list replays the server segmentation on the client', () => {
    // The whole point: what the reader computes from the list must match what
    // the server computed when it wrote the list.
    for (const [pack, text] of [
      [zh, '我喜欢读书。这本书很有意思！'],
      [ja, '私は日本語を勉強しています。'],
    ] as Array<[LanguageConfig, string]>) {
      const serverWords = tokenizeWords(text, pack).map((t) => t.text);
      const replayed = tokenizeWords(
        text,
        pack,
        makeWordSegmentation(JSON.parse(buildSegmentWords(text, pack)!) as string[]),
      ).map((t) => t.text);
      expect(replayed).toEqual(serverWords);
    }
  });

  test('handles Japanese through the same path as Chinese', () => {
    const stored = JSON.parse(buildSegmentWords('私は日本語を勉強しています。', ja)!) as string[];
    expect(stored).toContain('日本語');
    expect(stored).toContain('勉強');
  });
});
