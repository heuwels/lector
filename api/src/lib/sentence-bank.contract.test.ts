import '../test-guard';
import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

// The contract the reader relies on to render a cloze card. Each of these
// invariants was broken by a builder at some point, and each break shipped a
// card the learner could not answer.

interface BankRow {
  id: number | string;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  tokens?: string[];
  wordRank: number | null;
  collection: string;
}

const LIB = path.resolve(import.meta.dir);
const banks = fs
  .readdirSync(LIB)
  .filter((name) => /^sentence-bank-[a-z]+\.json$/.test(name))
  .map((name) => ({
    lang: name.slice('sentence-bank-'.length, -'.json'.length),
    rows: JSON.parse(fs.readFileSync(path.join(LIB, name), 'utf-8')) as BankRow[],
  }))
  .filter((bank) => bank.rows.length > 0);

// The unspaced packs. Their tokens cannot be re-derived from the text, so they
// must ship them (#289 4.3); every other pack must not, because the reader
// splits on whitespace and a stale array would disagree with it.
const UNSPACED = new Set(['zh', 'ja']);

describe('sentence bank contract', () => {
  test('finds the banks', () => {
    expect(banks.length).toBeGreaterThan(10);
    expect(banks.map((b) => b.lang)).toContain('ja');
    expect(banks.map((b) => b.lang)).toContain('ko');
  });

  for (const { lang, rows } of banks) {
    describe(lang, () => {
      test('every row carries the fields the reader reads', () => {
        for (const row of rows) {
          expect(typeof row.text, `${lang} ${row.id}`).toBe('string');
          expect(row.text.length, `${lang} ${row.id}`).toBeGreaterThan(0);
          expect(row.translation.length, `${lang} ${row.id}`).toBeGreaterThan(0);
          expect(row.clozeWord.length, `${lang} ${row.id}`).toBeGreaterThan(0);
          expect(Number.isInteger(row.clozeIndex), `${lang} ${row.id}`).toBe(true);
          expect(row.clozeIndex, `${lang} ${row.id}`).toBeGreaterThanOrEqual(0);
        }
      });

      test('ships tokens only when the script is unspaced', () => {
        const withTokens = rows.filter((row) => row.tokens !== undefined).length;
        expect(withTokens === 0 || withTokens === rows.length, `${lang} is inconsistent`).toBe(
          true,
        );
        expect(withTokens > 0).toBe(UNSPACED.has(lang));
      });

      test('clozeIndex addresses clozeWord', () => {
        for (const row of rows) {
          // An unspaced bank indexes its own tokens. A spaced one indexes the
          // whitespace split, which is what the reader re-derives.
          const tokens = row.tokens ?? row.text.split(/\s+/);
          expect(tokens[row.clozeIndex], `${lang} ${row.id}`).toBe(row.clozeWord);
        }
      });

      test('tokens rejoin to the text', () => {
        if (!UNSPACED.has(lang)) return;
        for (const row of rows) {
          // The reader draws the sentence by joining them, so a lossy split
          // changes what the learner reads.
          expect(row.tokens!.join(''), `${lang} ${row.id}`).toBe(row.text);
        }
      });

      test('bands are the ones the practice route knows', () => {
        for (const row of rows) {
          expect(
            ['top500', 'top1000', 'top2000', 'mined', 'random'],
            `${lang} ${row.id}`,
          ).toContain(row.collection);
        }
      });
    });
  }
});
