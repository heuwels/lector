import { describe, expect, test } from 'bun:test';
import {
  extractCaptionTracks,
  extractPlayerResponse,
  extractVideoMeta,
  formatTimestamp,
  parseJson3Transcript,
  parseYouTubeVideoId,
  segmentsToText,
  toJson3Url,
  watchUrlAt,
} from './youtube-transcript';

describe('parseYouTubeVideoId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc&t=30s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses %s', (input, expected) => {
    expect(parseYouTubeVideoId(input)).toBe(expected);
  });

  test.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/',
    'not a url',
    '',
  ])('rejects %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});

function playerJson(): string {
  return JSON.stringify({
    videoDetails: { title: 'My Video: "quoted" & { braces }', author: 'Some Channel' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
            name: { simpleText: 'English' },
            languageCode: 'en',
          },
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr',
            name: { runs: [{ text: 'English' }] },
            languageCode: 'en',
            kind: 'asr',
          },
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=af',
            name: { simpleText: 'Afrikaans' },
            languageCode: 'af',
          },
        ],
      },
    },
  });
}

describe('extractPlayerResponse + caption tracks (brace-matched, string-safe)', () => {
  const html = `<!doctype html><html><body><script>var ytInitialPlayerResponse = ${playerJson()};var other=1;</script></body></html>`;

  test('recovers the player object despite braces/quotes inside strings', () => {
    const player = extractPlayerResponse(html);
    expect(player).not.toBeNull();
    const meta = extractVideoMeta(player, 'abc12345678');
    expect(meta.title).toBe('My Video: "quoted" & { braces }');
    expect(meta.channel).toBe('Some Channel');
  });

  test('lists tracks and distinguishes creator vs auto-generated', () => {
    const tracks = extractCaptionTracks(extractPlayerResponse(html));
    expect(tracks).toHaveLength(3);
    expect(tracks[0]).toMatchObject({
      languageCode: 'en',
      kind: 'standard',
      languageName: 'English',
    });
    expect(tracks[1]).toMatchObject({
      languageCode: 'en',
      kind: 'asr',
      languageName: 'English (auto-generated)',
    });
    expect(tracks[2].languageCode).toBe('af');
  });

  test('returns [] when the page has no caption tracks', () => {
    const noCaps = `<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { title: 'x' } })};</script>`;
    expect(extractCaptionTracks(extractPlayerResponse(noCaps))).toEqual([]);
  });
});

describe('toJson3Url', () => {
  test('forces fmt=json3', () => {
    expect(toJson3Url('https://www.youtube.com/api/timedtext?v=abc&lang=en')).toContain(
      'fmt=json3',
    );
  });
  test('replaces an existing fmt', () => {
    const url = toJson3Url('https://www.youtube.com/api/timedtext?v=abc&fmt=srv3&lang=en');
    expect(url).toContain('fmt=json3');
    expect(url).not.toContain('fmt=srv3');
  });
});

describe('parseJson3Transcript', () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
      { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: '\n' }] }, // whitespace-only → dropped
      { tStartMs: 3500, dDurationMs: 1000, segs: [{ utf8: 'Goodbye' }] },
      { tStartMs: 5000 }, // no segs → dropped
    ],
  });

  test('parses timed cues and drops empty ones', () => {
    const segments = parseJson3Transcript(body);
    expect(segments).toEqual([
      { start: 0, end: 1.5, text: 'Hello world' },
      { start: 3.5, end: 4.5, text: 'Goodbye' },
    ]);
  });

  test('accepts a pre-parsed object and bad input safely', () => {
    expect(parseJson3Transcript(JSON.parse(body))).toHaveLength(2);
    expect(parseJson3Transcript('not json')).toEqual([]);
    expect(parseJson3Transcript({})).toEqual([]);
  });

  test('segmentsToText joins one cue per line', () => {
    expect(segmentsToText(parseJson3Transcript(body))).toBe('Hello world\nGoodbye');
  });
});

describe('timestamp helpers', () => {
  test('formatTimestamp', () => {
    expect(formatTimestamp(9)).toBe('0:09');
    expect(formatTimestamp(75)).toBe('1:15');
    expect(formatTimestamp(3661)).toBe('1:01:01');
  });
  test('watchUrlAt', () => {
    expect(watchUrlAt('abc12345678', 75.9)).toBe(
      'https://www.youtube.com/watch?v=abc12345678&t=75s',
    );
  });
});
