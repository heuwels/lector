import '../test-guard';
import { describe, expect, test } from 'bun:test';
import { parsePlanLimitOverrides } from './entitlements';
import { calculateFreeTakeoutUpperBound, FREE_RESTORE_ENVELOPE_BYTES } from './free-takeout-budget';

describe('Free takeout serialization budget', () => {
  test('the complete cap-valid Free JSON shape fits the 90 MiB restore envelope', () => {
    const proof = calculateFreeTakeoutUpperBound(parsePlanLimitOverrides(undefined).free);

    // This is deliberately much larger than raw learner text: the serialized
    // witness includes every field name and comma, 128-byte hostile primary +
    // foreign ids, all 20 senses and 50 related forms per accepted entry,
    // timestamps/numbers/languages, and worst-case 2x JSON string escaping.
    expect(proof.counts.clozeSentences).toBe(25_000);
    expect(proof.counts.acceptedDictionaryEntries).toBe(1_000);
    expect(proof.counts.learnerEvents).toBe(50);
    expect(proof.structureAndMetadataBytes).toBeGreaterThan(50 * 1024 * 1024);
    expect(proof.escapedLearnerTextBytes).toBeGreaterThan(35 * 1024 * 1024);
    expect(proof.totalBytes).toBe(93_293_832);
    expect(proof.totalBytes).toBeLessThanOrEqual(FREE_RESTORE_ENVELOPE_BYTES);
    expect(FREE_RESTORE_ENVELOPE_BYTES - proof.totalBytes).toBeGreaterThan(1 * 1024 * 1024);
  });
});
