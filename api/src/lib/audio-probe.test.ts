import '../test-guard';
import { describe, expect, test } from 'bun:test';
import { estimateTranscriptionMinutes } from './audio-probe';

describe('estimateTranscriptionMinutes', () => {
  test('rounds a probed duration up to whole minutes', () => {
    expect(estimateTranscriptionMinutes(60_000, 999)).toBe(1);
    expect(estimateTranscriptionMinutes(61_000, 999)).toBe(2);
    expect(estimateTranscriptionMinutes(40 * 60_000, 999)).toBe(40);
  });

  test('estimates from size at ~1 MiB/min when the probe failed', () => {
    expect(estimateTranscriptionMinutes(null, 5 * 1024 * 1024)).toBe(5);
    expect(estimateTranscriptionMinutes(0, 5 * 1024 * 1024 + 1)).toBe(6);
  });

  test('never returns less than one minute', () => {
    expect(estimateTranscriptionMinutes(null, 10)).toBe(1);
    expect(estimateTranscriptionMinutes(500, 10)).toBe(1);
  });
});
