import { describe, test, expect } from 'bun:test';
import { parseLooseJson, parseLooseJsonResult } from './parse-json';

describe('parseLooseJson', () => {
  test('parses plain JSON', () => {
    expect(parseLooseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  test('parses with surrounding whitespace', () => {
    expect(parseLooseJson<{ a: number }>('  \n {"a":1}\n ')).toEqual({ a: 1 });
  });

  test('strips a ```json fence', () => {
    expect(parseLooseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('strips a bare ``` fence', () => {
    expect(parseLooseJson<{ a: number }>('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('extracts an object from surrounding prose', () => {
    expect(parseLooseJson<{ a: number }>('Sure! Here you go: {"a":1} Hope that helps.')).toEqual({
      a: 1,
    });
  });

  test('keeps nested objects intact via the outermost span', () => {
    expect(parseLooseJson<{ a: { b: number } }>('prefix {"a":{"b":2}} suffix')).toEqual({
      a: { b: 2 },
    });
  });

  test('parses a top-level array', () => {
    expect(parseLooseJson<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  test('strips a <think> reasoning block before the JSON', () => {
    // The think block contains braces on purpose — naive span extraction would
    // slice from inside it and fail.
    const raw = '<think>The user wants {a:1}; I will return {"a":1}</think>\n{"a":1}';
    expect(parseLooseJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  test('strips a <think> block even before a fenced payload', () => {
    const raw = '<think>hmm { } braces</think>\n```json\n{"a":1}\n```';
    expect(parseLooseJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  test('handles a realistic fenced translation payload', () => {
    const raw = '```json\n{"word":"loop","senses":[{"partOfSpeech":"noun","gloss":"walk"}]}\n```';
    expect(
      parseLooseJson<{ word: string; senses: Array<{ partOfSpeech: string; gloss: string }> }>(raw),
    ).toEqual({
      word: 'loop',
      senses: [{ partOfSpeech: 'noun', gloss: 'walk' }],
    });
  });

  test('throws a clear error on non-JSON', () => {
    expect(() => parseLooseJson('not json at all')).toThrow('Model did not return valid JSON');
  });

  test('throws a clear error on empty string', () => {
    expect(() => parseLooseJson('')).toThrow('Model did not return valid JSON');
  });

  // --- jsonrepair fallback: structural noise that strict JSON.parse rejects but
  // which carries no ambiguity, so it can be repaired without dropping data.

  test('repairs a trailing comma', () => {
    expect(
      parseLooseJson<{ word: string; senses: string[] }>(
        '{ "word": "mos", "senses": ["of course", "moss",] }',
      ),
    ).toEqual({
      word: 'mos',
      senses: ['of course', 'moss'],
    });
  });

  test('reports whether repair closed a missing outer container', () => {
    const safe = parseLooseJsonResult<{ ok: boolean }>('{"ok":true,}');
    expect(safe).toEqual({ value: { ok: true }, repaired: true, rootComplete: true });

    const truncated = parseLooseJsonResult<{ translation: string; details: unknown[] }>(
      '{"translation":"partial","details":[]',
    );
    expect(truncated).toEqual({
      value: { translation: 'partial', details: [] },
      repaired: true,
      rootComplete: false,
    });
  });

  test('repairs single-quoted JSON from a local model', () => {
    expect(
      parseLooseJson<{ word: string; gloss: string }>("{ 'word': 'gaaf', 'gloss': 'cool, nice' }"),
    ).toEqual({
      word: 'gaaf',
      gloss: 'cool, nice',
    });
  });

  test('repairs unquoted keys/values within a brace span', () => {
    // Was previously asserted to throw; jsonrepair now recovers it. Only a real
    // {…} span is repaired, so bare prose ("not json at all") still throws.
    expect(parseLooseJson<{ partOfSpeech: string }>('text { partOfSpeech: noun } more')).toEqual({
      partOfSpeech: 'noun',
    });
  });

  test('recovers from a trailing ``` fence with no opening fence', () => {
    const raw = '{ "word": "goudbruin", "gloss": "golden brown" }\n```';
    expect(parseLooseJson<{ word: string; gloss: string }>(raw)).toEqual({
      word: 'goudbruin',
      gloss: 'golden brown',
    });
  });

  // --- The actual production bug: unescaped double-quotes inside a string value.
  // Both fixtures are REAL claude-sonnet-4-6 outputs that 500'd /api/translate.
  // Contract: parseLooseJson must EITHER parse them correctly OR throw cleanly —
  // never return an object with data silently clipped at the stray quote, since
  // these entries are persisted into the on-device dictionary. jsonrepair cannot
  // disambiguate inner quotes, so it throws and so do we. The prompts now ask
  // models to use single quotes inside values to avoid producing these.

  const REAL_UNESCAPED_QUOTE_1 = `{
  "word": "lekker",
  "senses": [
    { "partOfSpeech": "adjective", "gloss": "nice, pleasant, enjoyable" },
    { "partOfSpeech": "adjective", "gloss": "delicious, tasty (of food or drink)" },
    { "partOfSpeech": "adverb", "gloss": "well, nicely, thoroughly (intensifier)" },
    { "partOfSpeech": "adverb", "gloss": "deeply, soundly (e.g. lekker slaap — sleep soundly)" },
    { "partOfSpeech": "interjection", "gloss": "great!, awesome!, nice one!" },
    { "partOfSpeech": "adjective", "gloss": "feeling good, comfortable, at ease" }
  ],
  "ipa": "/ˈlɛkər/",
  "etymology": "From Dutch lekker ("tasty, nice, pleasant"), from Middle Dutch lecker, from leck ("licking"), related to likken ("to lick"); cognate with English lick and German lecker.",
  "relatedForms": [
    { "form": "lekkerder", "relation": "comparative of" },
    { "form": "lekkerste", "relation": "superlative of" },
    { "form": "lekkerte", "relation": "derived from (noun: a treat, a delicacy, a pleasure)" },
    { "form": "lekkernye", "relation": "derived from (noun: delicacies, sweets, treats)" },
    { "form": "lekker-lekker", "relation": "reduplicated intensified form (very nice indeed)" }
  ]
}`;

  const REAL_UNESCAPED_QUOTE_2 = `{
  "word": "lekker",
  "senses": [
    { "partOfSpeech": "adjective", "gloss": "nice, pleasant, good" },
    { "partOfSpeech": "adjective", "gloss": "tasty, delicious" },
    { "partOfSpeech": "adverb", "gloss": "nicely, well, thoroughly" },
    { "partOfSpeech": "interjection", "gloss": "great!, cool!, awesome!" },
    { "partOfSpeech": "adjective", "gloss": "feeling well, comfortable" }
  ],
  "ipa": "/ˈlɛkər/",
  "etymology": "From Dutch lekker ("delicious, nice, pleasant"), from Middle Dutch lecker, related to likken ("to lick"); cognate with English "licker" in archaic sense. Broadened semantically in Afrikaans to a general intensifier of positivity.",
  "relatedForms": [
    { "form": "lekkerder", "relation": "comparative of" },
    { "form": "lekkerste", "relation": "superlative of" },
    { "form": "lekkerheid", "relation": "derived from (noun: niceness, pleasantness)" },
    { "form": "lekker slaap", "relation": "fixed phrase (sleep well, goodnight)" },
    { "form": "lekkerny", "relation": "derived from (noun: delicacy, treat)" }
  ]
}`;

  test('throws (never clips) on unescaped inner quotes — real fixture 1', () => {
    expect(() => parseLooseJson(REAL_UNESCAPED_QUOTE_1)).toThrow('Model did not return valid JSON');
  });

  test('throws (never clips) on unescaped inner quotes — real fixture 2', () => {
    expect(() => parseLooseJson(REAL_UNESCAPED_QUOTE_2)).toThrow('Model did not return valid JSON');
  });

  test('preserves every received field when a response is truncated mid-value', () => {
    // A max_tokens cut-off in the middle of `etymology` — which sits after the
    // last complete bracket (the senses `]`). The repair must keep the already-
    // received `ipa` and the partial `etymology`, NOT slice them off at the `]`.
    // (In production the provider has comfortable headroom, so this is a backstop;
    // the contract is "keep what was sent", never silently drop received bytes.)
    const truncated =
      '{"word":"goud","senses":[{"partOfSpeech":"verb","gloss":"pull"}],"ipa":"/xoʊd/","etymology":"From Middle Dutch goud (gold';
    expect(
      parseLooseJson<{ word: string; senses: unknown[]; ipa: string; etymology: string }>(
        truncated,
      ),
    ).toEqual({
      word: 'goud',
      senses: [{ partOfSpeech: 'verb', gloss: 'pull' }],
      ipa: '/xoʊd/',
      etymology: 'From Middle Dutch goud (gold',
    });
  });
});
