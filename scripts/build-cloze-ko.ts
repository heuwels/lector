/**
 * Build the Korean cloze sentence bank from Tatoeba's kor -> eng exports.
 *
 *     npx tsx scripts/build-cloze-ko.ts
 *
 * WHY THIS ONE IS TYPESCRIPT while the other spaced builders are Python. A
 * Korean word arrives with its grammar attached, so 학생이 is one written token
 * holding 학생 plus a particle. Deciding which words a sentence contains means
 * peeling that, and the peel already exists in languages/morphology.ts, where
 * the runtime lookup and the dictionary coverage gate both read it. A Python
 * reimplementation would be a third copy free to drift from the other two.
 *
 * The bank shipS NO `tokens` array. Korean writes spaces, so `clozeIndex`
 * addresses the whitespace split and the client re-derives it, exactly as every
 * other spaced bank does.
 *
 * A CANDIDATE IS A LEMMA AND AN ANSWER IS AN EOJEOL. The learner sees a blank
 * where 학생이 stood and types 학생이, because that is what Korean writes. The
 * word being practised is 학생, and that is what the frequency bands rank. This
 * is the one place a Korean bank cannot copy a Slavic one: there, a frequency
 * list already holds the inflected surface, so candidate and answer are the same
 * string.
 *
 * Frequency comes from the Tatoeba corpus itself rather than from wordfreq. The
 * wordfreq Korean list holds MORPHEMES, and its head is 이, 는, 을 and 하 — 하 is
 * the stem of 하다 and not a word anyone taps. Counting eojeol in the sentences
 * and crediting each one to the lemma it peels to gives a word frequency built
 * from running text. See scripts/gen-coverage-corpus-ko.py, which rejected
 * wordfreq for the same reason.
 *
 * Prerequisites:
 *     npx tsx scripts/build-dictionary.ts --lang ko
 *
 * Requires `bunzip2` on PATH. Tatoeba serves bzip2, and Node ships no decoder.
 *
 * Downloads are cached in tmp/cloze-ko.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { stemCandidates } from '../languages/morphology';
import { ko } from '../languages/ko/manifest';
import type { MorphologyConfig } from '../languages/types';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TATOEBA = 'https://downloads.tatoeba.org/exports/per_language';
const LANGUAGE_CODE = 'kor';
const ENGLISH_CODE = 'eng';

const CACHE_DIR = path.join(PROJECT_ROOT, 'tmp', 'cloze-ko');
const DICTIONARY = path.join(PROJECT_ROOT, 'data', 'dictionary-ko.db');
const OUTPUT = path.join(PROJECT_ROOT, 'api', 'src', 'lib', 'sentence-bank-ko.json');

const MAX_WORDS = 2000;
const SENTENCES_PER_WORD = 6;
const MAX_OPTIONS_PER_WORD = 80;
const MIN_SENTENCE_WORDS = 3;
const MAX_SENTENCE_WORDS = 18;
const IDEAL_WORDS = 7;
const IDEAL_ENGLISH_WORDS = 8;

const CONTENT_PARTS_OF_SPEECH = new Set(['adj', 'adv', 'intj', 'noun', 'num', 'verb']);

// Precomposed Hangul syllables only. A jamo in the wild is a typo, and a Latin
// or Han token is not what this bank practises.
const HANGUL = /^[가-힣]+$/u;
// Leading and trailing non-Hangul only. Stripping the INSIDE of a token would
// produce a string the sentence does not contain, and 자폐증'은 would be stored
// as 자폐증은 while the reader draws the apostrophe. Interior punctuation
// therefore fails the Hangul test below and the token is skipped, which is the
// honest outcome for a token nobody can type back.
const EDGE_NON_HANGUL = /^[^가-힣]+|[^가-힣]+$/gu;

// Tatoeba writes its examples about a small invented cast, spelled several ways
// in the Korean set. No dictionary holds them, and they are not vocabulary.
const PLACEHOLDER_NAMES = ['톰', '탐', '메리', '매리', '라일라', '야니'];

const morphology = ko.morphology as MorphologyConfig;

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
  score: [number, number, number];
}

function ensureFile(name: string, kind: string): string {
  const compressed = path.join(CACHE_DIR, name);
  const plain = compressed.replace(/\.bz2$/, '');
  if (fs.existsSync(plain)) {
    console.log(`  cached: ${path.basename(plain)}`);
    return plain;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(compressed)) {
    const url = `${TATOEBA}/${kind}/${name}`;
    console.log(`  downloading ${url}`);
    execFileSync('curl', ['-fsSL', '--retry', '3', url, '-o', compressed], { stdio: 'inherit' });
  }
  console.log(`  decompressing ${name}`);
  fs.writeFileSync(
    plain,
    execFileSync('bunzip2', ['-c', compressed], { maxBuffer: 1024 * 1024 * 1024 }),
  );
  return plain;
}

function isPlaceholder(token: string): boolean {
  return PLACEHOLDER_NAMES.some((n) => token.startsWith(n) && token.length - n.length <= 2);
}

/**
 * Whitespace tokens with their edge punctuation removed, keeping the position.
 *
 * `clean` decides which word the token teaches. `raw` is what the bank stores as
 * the answer, because every spaced bank stores the whitespace token exactly, and
 * 40% of the Ukrainian answers carry a trailing comma or stop.
 */
function eojeol(text: string): Array<{ raw: string; clean: string; index: number }> {
  return text.split(/\s+/).map((raw, index) => ({
    raw,
    clean: raw.replace(EDGE_NON_HANGUL, ''),
    index,
  }));
}

interface Dict {
  isEntry(word: string): boolean;
  lemmaOf(word: string): string | undefined;
  contentPos(word: string): boolean;
}

function openDictionary(): Dict {
  if (!fs.existsSync(DICTIONARY)) {
    throw new Error(`${DICTIONARY} does not exist; run the Korean dictionary build first`);
  }
  const db = new Database(DICTIONARY, { readonly: true });
  const entry = db.prepare('SELECT 1 FROM entries WHERE word = ?');
  const infl = db.prepare('SELECT lemma FROM inflections WHERE inflected_form = ? LIMIT 1');
  const pos = db.prepare('SELECT DISTINCT pos FROM senses WHERE word = ?');
  const entryCache = new Map<string, boolean>();
  const posCache = new Map<string, boolean>();
  return {
    isEntry(word) {
      let hit = entryCache.get(word);
      if (hit === undefined) {
        hit = !!entry.get(word);
        entryCache.set(word, hit);
      }
      return hit;
    },
    lemmaOf(word) {
      const row = infl.get(word) as { lemma: string } | undefined;
      return row?.lemma;
    },
    contentPos(word) {
      let hit = posCache.get(word);
      if (hit === undefined) {
        const rows = pos.all(word) as Array<{ pos: string | null }>;
        const parts = new Set(rows.map((r) => r.pos).filter((p): p is string => !!p));
        hit =
          parts.size > 0 &&
          !parts.has('name') &&
          [...parts].some((p) => CONTENT_PARTS_OF_SPEECH.has(p));
        posCache.set(word, hit);
      }
      return hit;
    },
  };
}

/**
 * The dictionary word an eojeol teaches, or undefined.
 *
 * Same order as the runtime lookup: the written form, then the conjugation
 * table, then the peel. So 학생이 credits 학생 and 먹었어요 credits 먹다.
 */
function lemmaFor(token: string, dict: Dict): string | undefined {
  if (dict.isEntry(token)) return token;
  const direct = dict.lemmaOf(token);
  if (direct && dict.isEntry(direct)) return direct;
  for (const candidate of stemCandidates(token, morphology)) {
    if (dict.isEntry(candidate.key)) return candidate.key;
    const lemma = dict.lemmaOf(candidate.key);
    if (lemma && dict.isEntry(lemma)) return lemma;
  }
  return undefined;
}

interface Sentence {
  text: string;
  words: Array<{ raw: string; clean: string; index: number }>;
}

function loadSentences(tsv: string): Map<number, Sentence> {
  const out = new Map<number, Sentence>();
  for (const line of fs.readFileSync(tsv, 'utf-8').split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const id = Number(parts[0]);
    if (!Number.isSafeInteger(id)) continue;
    const text = parts[2].normalize('NFC').trim();
    const words = eojeol(text);
    const hangulWords = words.filter((w) => HANGUL.test(w.clean)).length;
    if (hangulWords < MIN_SENTENCE_WORDS || hangulWords > MAX_SENTENCE_WORDS) continue;
    out.set(id, { text, words });
  }
  return out;
}

function loadLinks(tsv: string, wanted: Set<number>) {
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

/** Lemma frequency counted over the corpus, most frequent first. */
function buildCandidates(sentences: Map<number, Sentence>, dict: Dict): Candidate[] {
  const counts = new Map<string, number>();
  for (const { words } of sentences.values()) {
    for (const { clean } of words) {
      if (!clean || !HANGUL.test(clean) || isPlaceholder(clean)) continue;
      const lemma = lemmaFor(clean, dict);
      if (!lemma) continue;
      counts.set(lemma, (counts.get(lemma) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .filter(([word]) => {
      // A one-syllable answer is guessable from the blank's width, and the
      // avoided words carry grammar rather than meaning.
      if (word.length < 2) return false;
      if (ko.avoidWords.has(word)) return false;
      return dict.contentPos(word);
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_WORDS);

  console.log(`Candidates: ${ranked.length} content words ranked by corpus frequency`);
  return ranked.map(([word], i) => ({ word, rank: i + 1 }));
}

function collectOptions(
  sentences: Map<number, Sentence>,
  links: Map<number, number[]>,
  english: Map<number, string>,
  candidates: Candidate[],
  dict: Dict,
): Map<string, Option[]> {
  const wanted = new Set(candidates.map((c) => c.word));
  const options = new Map<string, Option[]>();
  const seenTexts = new Set<string>();

  for (const id of [...sentences.keys()].sort((a, b) => a - b)) {
    const { text, words } = sentences.get(id)!;
    if (seenTexts.has(text)) continue;
    const translation = (links.get(id) ?? []).map((e) => english.get(e)).find((t) => !!t);
    if (!translation) continue;

    const hits = new Map<string, { raw: string; index: number }>();
    for (const { raw, clean, index } of words) {
      if (!clean || !HANGUL.test(clean) || isPlaceholder(clean)) continue;
      const lemma = lemmaFor(clean, dict);
      if (!lemma || !wanted.has(lemma) || hits.has(lemma)) continue;
      // The answer is the whitespace token exactly as written, matching every
      // other spaced bank. The reader blanks tokens[clozeIndex], so anything
      // else would blank one string and grade another.
      hits.set(lemma, { raw, index });
    }
    if (hits.size === 0) continue;
    seenTexts.add(text);

    const hangulWords = words.filter((w) => HANGUL.test(w.clean)).length;
    const score: [number, number, number] = [
      Math.abs(hangulWords - IDEAL_WORDS),
      Math.abs(translation.split(/\s+/).length - IDEAL_ENGLISH_WORDS),
      id,
    ];
    for (const [lemma, { raw, index }] of hits) {
      const list = options.get(lemma) ?? [];
      list.push({
        sentenceId: id,
        text,
        translation,
        clozeWord: raw,
        clozeIndex: index,
        score,
      });
      options.set(lemma, list);
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

function selectBank(candidates: Candidate[], options: Map<string, Option[]>) {
  const selected = new Map<number, Option[]>();
  const used = new Set<number>();
  const byScarcity = [...candidates].sort(
    (a, b) =>
      (options.get(a.word)?.length ?? 0) - (options.get(b.word)?.length ?? 0) || a.rank - b.rank,
  );
  for (const candidate of byScarcity) {
    const chosen: Option[] = [];
    for (const option of options.get(candidate.word) ?? []) {
      if (used.has(option.sentenceId)) continue;
      chosen.push(option);
      used.add(option.sentenceId);
      if (chosen.length === SENTENCES_PER_WORD) break;
    }
    if (chosen.length) selected.set(candidate.rank, chosen);
  }

  const bank: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    for (const option of (selected.get(candidate.rank) ?? []).sort(
      (a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2],
    )) {
      bank.push({
        id: option.sentenceId,
        text: option.text,
        translation: option.translation,
        clozeWord: option.clozeWord,
        clozeIndex: option.clozeIndex,
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
    const tokens = (row.text as string).split(/\s+/);
    const at = tokens[row.clozeIndex as number];
    if (at !== row.clozeWord) {
      throw new Error(`token ${at} at ${row.clozeIndex} is not ${row.clozeWord} (${row.id})`);
    }
    if (!HANGUL.test((row.clozeWord as string).replace(EDGE_NON_HANGUL, ''))) {
      throw new Error(`clozeWord ${row.clozeWord} holds no Hangul run`);
    }
    if ('tokens' in row) throw new Error('a spaced bank must not ship tokens');
  }
  console.log(`Verified ${bank.length} rows: clozeIndex addresses a token holding clozeWord`);
}

function main(): void {
  console.log('Tatoeba files:');
  const sentencesTsv = ensureFile(`${LANGUAGE_CODE}_sentences.tsv.bz2`, LANGUAGE_CODE);
  const linksTsv = ensureFile(`${LANGUAGE_CODE}-${ENGLISH_CODE}_links.tsv.bz2`, LANGUAGE_CODE);
  const englishTsv = ensureFile(`${ENGLISH_CODE}_sentences.tsv.bz2`, ENGLISH_CODE);

  const dict = openDictionary();
  const sentences = loadSentences(sentencesTsv);
  const { links, english: neededEnglish } = loadLinks(linksTsv, new Set(sentences.keys()));
  const english = loadEnglish(englishTsv, neededEnglish);
  console.log(
    `Tatoeba: ${sentences.size} length-filtered sentences; ${links.size} linked; ${english.size} English translations`,
  );

  const candidates = buildCandidates(sentences, dict);
  const options = collectOptions(sentences, links, english, candidates, dict);
  const bank = selectBank(candidates, options);
  verify(bank);

  const covered = new Set(bank.map((r) => r.clozeWord)).size;
  console.log(`Bank: ${bank.length} sentences covering ${covered} distinct answers`);
  fs.writeFileSync(OUTPUT, JSON.stringify(bank, null, 0) + '\n');
  console.log(`Wrote ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB)`);
}

main();
