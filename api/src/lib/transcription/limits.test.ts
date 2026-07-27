import '../../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_ASR_MAX_FILE_BYTES,
  getTranscriptionLimits,
  resetTranscriptionProvider,
} from './index';
import { DEFAULT_MAX_CHUNK_SECONDS } from './chunked';

const ENV_KEYS = ['ASR_MAX_FILE_BYTES', 'ASR_CHUNK_SECONDS'] as const;
const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = saved.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  resetTranscriptionProvider();
});

describe('getTranscriptionLimits', () => {
  test('defaults to a 100 MB lesson ceiling and 10-minute chunks', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getTranscriptionLimits()).toEqual({
      maxFileBytes: DEFAULT_ASR_MAX_FILE_BYTES,
      maxChunkSeconds: DEFAULT_MAX_CHUNK_SECONDS,
    });
    expect(DEFAULT_ASR_MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });

  test('takes overrides from the environment', () => {
    process.env.ASR_MAX_FILE_BYTES = '52428800';
    process.env.ASR_CHUNK_SECONDS = '120';
    expect(getTranscriptionLimits()).toEqual({ maxFileBytes: 52428800, maxChunkSeconds: 120 });
  });

  test('ignores junk and non-positive values rather than disabling the limits', () => {
    process.env.ASR_MAX_FILE_BYTES = 'lots';
    process.env.ASR_CHUNK_SECONDS = '0';
    expect(getTranscriptionLimits()).toEqual({
      maxFileBytes: DEFAULT_ASR_MAX_FILE_BYTES,
      maxChunkSeconds: DEFAULT_MAX_CHUNK_SECONDS,
    });
  });
});
