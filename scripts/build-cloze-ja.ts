/**
 * Build the Japanese cloze sentence bank from Tatoeba's jpn -> eng exports.
 *
 *     npx tsx scripts/build-cloze-ja.ts
 *
 * WHY THIS ONE IS TYPESCRIPT while most cloze builders are Python. A Japanese
 * bank has to ship a `tokens` array, because the script writes no spaces and the
 * client cannot re-derive the split (#289 4.3). That split has to be the SAME
 * one the reader uses, and the reader uses kuromoji through
 * api/src/lib/ja-morphology. Mandarin shows what the alternative costs: its bank
 * was segmented with jieba while the reader segments with Intl.Segmenter, the
 * two disagree on some boundaries, and a tap can select the wrong word.
 *
 * kuromoji is declared in api/package.json and not at the root, and this script
 * still reaches it. ja-morphology requires it through
 * `createRequire(import.meta.url)`, which resolves from that module's own
 * directory inside api/ rather than from whatever imports it.
 *
 * Prerequisites:
 *     npx tsx scripts/build-dictionary.ts --lang ja
 *
 * Requires `bunzip2` on PATH. Tatoeba serves bzip2, and Node ships no decoder.
 *
 * Downloads are cached in tmp/cloze-ja.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { segmentJapanese, japaneseAnalyserReady } from '../api/src/lib/ja-morphology';
import { ja } from '../languages/ja/manifest';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TATOEBA = 'https://downloads.tatoeba.org/exports/per_language';
const LANGUAGE_CODE = 'jpn';
const ENGLISH_CODE = 'eng';

const CACHE_DIR = path.join(PROJECT_ROOT, 'tmp', 'cloze-ja');
const DICTIONARY = path.join(PROJECT_ROOT, 'data', 'dictionary-ja.db');
const CORPUS = path.join(PROJECT_ROOT, 'scripts', 'coverage-corpus-ja.txt');
const OUTPUT = path.join(PROJECT_ROOT, 'api', 'src', 'lib', 'sentence-bank-ja.json');

const MAX_WORDS = 2000;
const SENTENCES_PER_WORD = 6;
const MAX_OPTIONS_PER_WORD = 80;
// Counted in kuromoji TOKENS, not characters. A Japanese sentence of eight
// tokens carries about the reading load of an eight-word Czech one, which is
// what the spaced builders aim at.
const MIN_SENTENCE_TOKENS = 4;
const MAX_SENTENCE_TOKENS = 20;
const IDEAL_TOKENS = 8;
const IDEAL_ENGLISH_WORDS = 8;

// A sense with one of these is worth blanking. `name` is excluded outright: a
// proper noun is not vocabulary, and wordfreq ranks one by English usage.
const CONTENT_PARTS_OF_SPEECH = new Set(['adj', 'adv', 'intj', 'noun', 'num', 'verb']);

// Kana and kanji, mirroring the ja dictionary profile's letterClass. A Latin
// token is a loan abbreviation or a brand, and neither makes a cloze answer.
const JA_WORD = /^[ぁ-ゟ゠-ヿ々㐀-䶿一-鿿豈-﫿]+$/u;

interface Candidate {
  word: string;
  rank: number;
}

interface Option {
  sentenceId: number;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  tokens: string[];
  score: [number, number, number];
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' });
}

function ensureFile(name: string): string {
  const compressed = path.join(CACHE_DIR, name);
  const plain = compressed.replace(/\.bz2$/, '');
  if (fs.existsSync(plain)) {
    console.log(`  cached: ${path.basename(plain)}`);
    return plain;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const kind = name.startsWith(ENGLISH_CODE) ? ENGLISH_CODE : LANGUAGE_CODE;
  if (!fs.existsSync(compressed)) {
    const url = `${TATOEBA}/${kind}/${name}`;
    console.log(`  downloading ${url}`);
    run('curl', ['-fL', '--retry', '3', url, '-o', compressed]);
  }
  console.log(`  decompressing ${name}`);
  const decoded = execFileSync('bunzip2', ['-c', compressed], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  fs.writeFileSync(plain, decoded);
  return plain;
}

/** Frequency-ordered candidates the dictionary can actually define. */
function buildCandidates(): Candidate[] {
  if (!fs.existsSync(DICTIONARY)) {
    throw new Error(`${DICTIONARY} does not exist; build the ja dictionary first`);
  }
  const db = new Database(DICTIONARY, { readonly: true });
  const posQuery = db.prepare('SELECT DISTINCT pos FROM senses WHERE word = ?');

  // The committed coverage corpus IS the wordfreq top-5000 in frequency order,
  // so it serves as the candidate list and this script needs no Python.
  const words = fs
    .readFileSync(CORPUS, 'utf-8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (candidates.length === MAX_WORDS) break;
    if (seen.has(word)) continue;
    // A one-character answer is guessable from the blank's width and teaches
    // little. It stays in the DICTIONARY, which is where a reader wants it.
    if (word.length < 2) continue;
    if (ja.avoidWords.has(word)) continue;
    if (!JA_WORD.test(word)) continue;
    const rows = posQuery.all(word) as Array<{ pos: string | null }>;
    const parts = new Set(rows.map((r) => r.pos).filter((p): p is string => !!p));
    if (parts.size === 0 || parts.has('name')) continue;
    if (![...parts].some((p) => CONTENT_PARTS_OF_SPEECH.has(p))) continue;
    seen.add(word);
    candidates.push({ word, rank: candidates.length + 1 });
  }
  db.close();
  console.log(`Candidates: ${candidates.length} content words (proper names excluded)`);
  return candidates;
}

interface Sentence {
  text: string;
  tokens: string[];
}

function loadSentences(tsv: string): Map<number, Sentence> {
  const out = new Map<number, Sentence>();
  let skippedLossy = 0;
  for (const line of fs.readFileSync(tsv, 'utf-8').split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const id = Number(parts[0]);
    if (!Number.isSafeInteger(id)) continue;
    const text = parts[2].normalize('NFC');
    const tokens = segmentJapanese(text);
    if (!tokens) throw new Error('analyser unavailable');
    const words = tokens.filter((t) => JA_WORD.test(t)).length;
    if (words < MIN_SENTENCE_TOKENS || words > MAX_SENTENCE_TOKENS) continue;
    // The reader renders a card by joining `tokens`, so a split that does not
    // rejoin would change the sentence. Drop the row rather than ship it.
    if (tokens.join('') !== text) {
      skippedLossy++;
      continue;
    }
    out.set(id, { text, tokens });
  }
  if (skippedLossy) console.log(`  dropped ${skippedLossy} sentences whose split was lossy`);
  return out;
}

function loadLinks(
  tsv: string,
  wanted: Set<number>,
): { links: Map<number, number[]>; english: Set<number> } {
  const links = new Map<number, number[]>();
  const english = new Set<number>();
  for (const line of fs.readFileSync(tsv, 'utf-8').split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const from = Number(parts[0]);
    const to = Number(parts[1]);
    if (!wanted.has(from)) continue;
    const list = links.get(from);
    if (list) list.push(to);
    else links.set(from, [to]);
    english.add(to);
  }
  return { links, english };
}

function loadEnglish(tsv: string, wanted: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of fs.readFileSync(tsv, 'utf-8').split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const id = Number(parts[0]);
    if (!wanted.has(id)) continue;
    out.set(id, parts[2]);
  }
  return out;
}

/**
 * Candidate words that appear as WHOLE tokens, with the index of the first hit.
 *
 * Whole tokens only, exactly as the spaced builders match whole whitespace
 * tokens. `clozeIndex` addresses a token and not a character range, so a
 * substring match would blank part of a word the reader could never highlight.
 */
function matches(tokens: string[], words: Set<string>): Map<string, number> {
  const found = new Map<string, number>();
  tokens.forEach((token, index) => {
    if (words.has(token) && !found.has(token)) found.set(token, index);
  });
  return found;
}

function collectOptions(
  sentences: Map<number, Sentence>,
  links: Map<number, number[]>,
  english: Map<number, string>,
  candidates: Candidate[],
): Map<string, Option[]> {
  const words = new Set(candidates.map((c) => c.word));
  const options = new Map<string, Option[]>();
  const seenTexts = new Set<string>();

  for (const id of [...sentences.keys()].sort((a, b) => a - b)) {
    const { text, tokens } = sentences.get(id)!;
    if (seenTexts.has(text)) continue;
    const translation = (links.get(id) ?? []).map((e) => english.get(e)).find((t) => !!t);
    if (!translation) continue;
    const hits = matches(tokens, words);
    if (hits.size === 0) continue;
    seenTexts.add(text);

    const wordCount = tokens.filter((t) => JA_WORD.test(t)).length;
    const score: [number, number, number] = [
      Math.abs(wordCount - IDEAL_TOKENS),
      Math.abs(translation.split(/\s+/).length - IDEAL_ENGLISH_WORDS),
      id,
    ];
    for (const [word, index] of hits) {
      const list = options.get(word) ?? [];
      list.push({
        sentenceId: id,
        text,
        translation,
        clozeWord: word,
        clozeIndex: index,
        tokens,
        score,
      });
      options.set(word, list);
    }
  }

  for (const [word, list] of options) {
    list.sort(
      (a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2],
    );
    options.set(word, list.slice(0, MAX_OPTIONS_PER_WORD));
  }
  return options;
}

function collectionForRank(rank: number): string {
  if (rank <= 500) return 'top500';
  if (rank <= 1000) return 'top1000';
  return 'top2000';
}

function selectBank(candidates: Candidate[], options: Map<string, Option[]>): unknown[] {
  const selected = new Map<number, Option[]>();
  const usedSentences = new Set<number>();

  // Scarce words pick first from their few usable sentences. A common word is
  // handled later and has enough alternatives to survive the collisions.
  const byScarcity = [...candidates].sort(
    (a, b) =>
      (options.get(a.word)?.length ?? 0) - (options.get(b.word)?.length ?? 0) || a.rank - b.rank,
  );
  for (const candidate of byScarcity) {
    const chosen: Option[] = [];
    for (const option of options.get(candidate.word) ?? []) {
      if (usedSentences.has(option.sentenceId)) continue;
      chosen.push(option);
      usedSentences.add(option.sentenceId);
      if (chosen.length === SENTENCES_PER_WORD) break;
    }
    if (chosen.length) selected.set(candidate.rank, chosen);
  }

  const bank: unknown[] = [];
  for (const candidate of candidates) {
    const chosen = (selected.get(candidate.rank) ?? []).sort(
      (a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2],
    );
    for (const option of chosen) {
      bank.push({
        id: option.sentenceId,
        text: option.text,
        translation: option.translation,
        clozeWord: option.clozeWord,
        clozeIndex: option.clozeIndex,
        // Unspaced: the client cannot re-derive this (#289 4.3).
        tokens: option.tokens,
        wordRank: candidate.rank,
        collection: collectionForRank(candidate.rank),
      });
    }
  }
  return bank;
}

/** Fail the build rather than ship a bank the runtime cannot render. */
function verify(bank: Array<Record<string, unknown>>): void {
  for (const row of bank) {
    const tokens = row.tokens as string[];
    if (tokens.join('') !== row.text) {
      throw new Error(`tokens do not rejoin for ${row.id}: ${tokens.join('')} != ${row.text}`);
    }
    if (tokens[row.clozeIndex as number] !== row.clozeWord) {
      throw new Error(`clozeIndex ${row.clozeIndex} is not ${row.clozeWord} for ${row.id}`);
    }
    if (!JA_WORD.test(row.clozeWord as string)) {
      throw new Error(`clozeWord ${row.clozeWord} is not kana or kanji`);
    }
  }
  console.log(`Verified ${bank.length} rows: tokens rejoin, clozeIndex addresses clozeWord`);
}

function main(): void {
  if (!japaneseAnalyserReady()) throw new Error('the Japanese analyser did not load');

  console.log('Tatoeba files:');
  const sentencesTsv = ensureFile(`${LANGUAGE_CODE}_sentences.tsv.bz2`);
  const linksTsv = ensureFile(`${LANGUAGE_CODE}-${ENGLISH_CODE}_links.tsv.bz2`);
  const englishTsv = ensureFile(`${ENGLISH_CODE}_sentences.tsv.bz2`);

  const candidates = buildCandidates();
  const sentences = loadSentences(sentencesTsv);
  const { links, english: neededEnglish } = loadLinks(linksTsv, new Set(sentences.keys()));
  const english = loadEnglish(englishTsv, neededEnglish);
  console.log(
    `Tatoeba: ${sentences.size} length-filtered sentences; ${links.size} linked; ${english.size} English translations`,
  );

  const options = collectOptions(sentences, links, english, candidates);
  const bank = selectBank(candidates, options) as Array<Record<string, unknown>>;
  verify(bank);

  const covered = new Set(bank.map((row) => row.clozeWord)).size;
  console.log(`Bank: ${bank.length} sentences covering ${covered} of ${candidates.length} words`);
  fs.writeFileSync(OUTPUT, JSON.stringify(bank, null, 0) + '\n');
  console.log(`Wrote ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1)} MB)`);
}

main();
