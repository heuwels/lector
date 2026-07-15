import type { AtomicLimitCheck, LimitMetric } from './entitlements';

export const MAX_PERSISTED_ID_BYTES = 128;
const ID_CONTROL_CHARACTERS = /[\u0000-\u001f]/;

export function validatePersistedId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'id must be a non-empty string';
  if (ID_CONTROL_CHARACTERS.test(value)) return 'id must not contain control characters';
  if (utf8Bytes(value) > MAX_PERSISTED_ID_BYTES) {
    return `id exceeds the ${MAX_PERSISTED_ID_BYTES}-byte persisted-id limit`;
  }
  return null;
}

/** SQLite stores TEXT as UTF-8. Buffer.byteLength therefore matches
 * `length(CAST(column AS BLOB))`, which the entitlement engine uses for live
 * aggregate usage. Keeping both sides on bytes avoids multi-byte Unicode
 * slipping past a character-count boundary. */
export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');
}

export function lessonTextBytes(textContent: unknown, title?: unknown): number {
  return utf8Bytes(textContent) + utf8Bytes(title);
}

export function collectionMetadataBytes(input: {
  title?: unknown;
  author?: unknown;
  coverUrl?: unknown;
}): number {
  return utf8Bytes(input.title) + utf8Bytes(input.author) + utf8Bytes(input.coverUrl);
}

export function vocabContentBytes(input: {
  text?: unknown;
  sentence?: unknown;
  translation?: unknown;
}): number {
  return utf8Bytes(input.text) + utf8Bytes(input.sentence) + utf8Bytes(input.translation);
}

export function clozeContentBytes(input: {
  sentence?: unknown;
  clozeWord?: unknown;
  translation?: unknown;
}): number {
  return utf8Bytes(input.sentence) + utf8Bytes(input.clozeWord) + utf8Bytes(input.translation);
}

export function journalContentBytes(input: {
  body?: unknown;
  correctedBody?: unknown;
  corrections?: unknown;
}): number {
  return utf8Bytes(input.body) + utf8Bytes(input.correctedBody) + utf8Bytes(input.corrections);
}

export function ankiPendingContentBytes(input: {
  word?: unknown;
  sentence?: unknown;
  translation?: unknown;
  meaning?: unknown;
  sourceUrl?: unknown;
}): number {
  return (
    utf8Bytes(input.word) +
    utf8Bytes(input.sentence) +
    utf8Bytes(input.translation) +
    utf8Bytes(input.meaning) +
    utf8Bytes(input.sourceUrl)
  );
}

export interface AcceptedDictionaryContent {
  word: string;
  senses: Array<{ partOfSpeech?: string; gloss: string }>;
  ipa?: string;
  etymology?: string;
  sourceSentence?: string;
  relatedForms?: Array<{ form: string; relation: string }>;
}

export function acceptedDictionaryContentBytes(input: AcceptedDictionaryContent): number {
  return (
    utf8Bytes(input.word) +
    utf8Bytes(input.ipa) +
    utf8Bytes(input.etymology) +
    utf8Bytes(input.sourceSentence) +
    input.senses.reduce(
      (total, sense) => total + utf8Bytes(sense.partOfSpeech) + utf8Bytes(sense.gloss),
      0,
    ) +
    (input.relatedForms ?? []).reduce(
      (total, related) => total + utf8Bytes(related.form) + utf8Bytes(related.relation),
      0,
    )
  );
}

/** Add a direct per-row size check only when a write grows that row. This is
 * the compatibility carve-out for legacy oversized rows: same-size restores
 * and shrinking edits remain possible after downgrade. */
export function growingRowCheck(
  metric: LimitMetric,
  nextBytes: number,
  previousBytes = 0,
): AtomicLimitCheck[] {
  return nextBytes > previousBytes ? [{ metric, requested: nextBytes }] : [];
}

/** Add an aggregate live-byte check only for positive growth. Non-increasing
 * updates remain usable even while existing data is above a new Free cap. */
export function aggregateGrowthCheck(
  metric: LimitMetric,
  nextBytes: number,
  previousBytes = 0,
): AtomicLimitCheck[] {
  const growth = nextBytes - previousBytes;
  return growth > 0 ? [{ metric, requested: growth }] : [];
}

export function batchGrowthCheck(growthBytes: number): AtomicLimitCheck[] {
  return growthBytes > 0 ? [{ metric: 'maxWriteBatchBytes', requested: growthBytes }] : [];
}
