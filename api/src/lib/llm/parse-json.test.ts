import { describe, test, expect } from 'bun:test';
import { parseLooseJson } from './parse-json';

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
    expect(parseLooseJson<{ a: number }>('Sure! Here you go: {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  test('keeps nested objects intact via the outermost span', () => {
    expect(parseLooseJson<{ a: { b: number } }>('prefix {"a":{"b":2}} suffix')).toEqual({ a: { b: 2 } });
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
    expect(parseLooseJson<{ word: string; senses: Array<{ partOfSpeech: string; gloss: string }> }>(raw)).toEqual({
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

  test('throws when the brace span is not valid JSON', () => {
    expect(() => parseLooseJson('text { not: valid } more')).toThrow('Model did not return valid JSON');
  });
});
