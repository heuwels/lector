/**
 * Bulk-fetch Afrikaans sentences from Tatoeba data dumps and save as a static JSON file.
 *
 * Usage: npx tsx scripts/fetch-sentences.ts
 *
 * Downloads Tatoeba's per-language TSV dumps (small files), joins Afrikaans
 * sentences with their English translations, determines best cloze words
 * using dictionary frequency data, and saves as src/lib/sentence-bank.json.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Dictionary loading (mirrors src/lib/dictionary.ts logic but standalone)
// ---------------------------------------------------------------------------

interface DictionaryEntry {
  word: string;
  rank: number;
  translation: string;
  partOfSpeech: string;
}

const dictionaryPath = path.resolve(__dirname, '../src/lib/dictionary-data.json');
const dictionaryData: DictionaryEntry[] = JSON.parse(fs.readFileSync(dictionaryPath, 'utf-8'));
const dictionaryMap = new Map<string, DictionaryEntry>();
for (const entry of dictionaryData) {
  dictionaryMap.set(entry.word.toLowerCase(), entry);
}

function lookupWord(word: string): DictionaryEntry | undefined {
  return dictionaryMap.get(word.toLowerCase());
}

// ---------------------------------------------------------------------------
// Cloze logic (mirrors src/lib/tatoeba.ts)
// ---------------------------------------------------------------------------

const AVOID_WORDS = new Set([
  "'n", "die", "en", "of", "in", "op", "vir", "met", "na", "van",
  "is", "het", "om", "te", "dat", "wat", "as", "aan", "by", "sy", "hy",
  "nie", "ek", "jy", "ons", "hulle", "dit", "was", "sal", "kan", "moet",
  "maar", "ook", "al", "nog", "so", "toe", "nou", "net", "eers", "dan",
]);

type ClozeCollection = 'top500' | 'top1000' | 'top2000' | 'random';

function findBestClozeWord(sentence: string): { word: string; index: number; rank: number | undefined } {
  const words = sentence.split(/\s+/);
  let bestWord = { word: words[0], index: 0, rank: undefined as number | undefined };
  let bestRank = Infinity;

  for (let i = 0; i < words.length; i++) {
    const cleanWord = words[i].replace(/[.,!?;:'"()[\]{}]/g, '').toLowerCase();
    if (cleanWord.length < 3 || AVOID_WORDS.has(cleanWord)) continue;

    const entry = lookupWord(cleanWord);
    if (entry) {
      if (entry.rank < bestRank) {
        bestRank = entry.rank;
        bestWord = { word: words[i], index: i, rank: entry.rank };
      }
    } else if (bestRank === Infinity) {
      if (cleanWord.length > bestWord.word.length) {
        bestWord = { word: words[i], index: i, rank: undefined };
      }
    }
  }

  return bestWord;
}

function getCollectionForRank(rank: number | undefined): ClozeCollection {
  if (rank === undefined) return 'random';
  if (rank <= 500) return 'top500';
  if (rank <= 1000) return 'top1000';
  if (rank <= 2000) return 'top2000';
  return 'random';
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

const TATOEBA_DOWNLOADS = 'https://downloads.tatoeba.org/exports/per_language';
const TMP_DIR = path.resolve(__dirname, '../.tmp-tatoeba');

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (reqUrl: string) => {
      https.get(reqUrl, { family: 4 }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            request(location);
            return;
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', reject);
    };
    request(url);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SentenceBankEntry {
  id: number;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  wordRank: number | null;
  collection: ClozeCollection;
}

const MIN_WORDS = 4;
const MAX_WORDS = 20;

async function main() {
  console.log('=== Afrikaans Sentence Fetcher (Bulk Dump) ===');
  console.log(`Dictionary loaded: ${dictionaryMap.size} words`);
  console.log('');

  // Create temp directory
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Download the three files we need
  const files = [
    { name: 'afr_sentences.tsv.bz2', url: `${TATOEBA_DOWNLOADS}/afr/afr_sentences.tsv.bz2` },
    { name: 'afr-eng_links.tsv.bz2', url: `${TATOEBA_DOWNLOADS}/afr/afr-eng_links.tsv.bz2` },
    { name: 'eng_sentences.tsv.bz2', url: `${TATOEBA_DOWNLOADS}/eng/eng_sentences.tsv.bz2` },
  ];

  for (const f of files) {
    const dest = path.join(TMP_DIR, f.name);
    if (fs.existsSync(dest)) {
      console.log(`  Already downloaded: ${f.name}`);
      continue;
    }
    console.log(`  Downloading ${f.name}...`);
    await downloadFile(f.url, dest);
    console.log(`  Downloaded: ${f.name} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  }

  // Decompress
  console.log('\nDecompressing...');
  for (const f of files) {
    const bzPath = path.join(TMP_DIR, f.name);
    const tsvPath = bzPath.replace('.bz2', '');
    if (fs.existsSync(tsvPath)) {
      console.log(`  Already decompressed: ${f.name.replace('.bz2', '')}`);
      continue;
    }
    execSync(`bunzip2 -k "${bzPath}"`, { cwd: TMP_DIR });
    console.log(`  Decompressed: ${f.name.replace('.bz2', '')}`);
  }

  // Load Afrikaans sentences: id → text
  console.log('\nLoading Afrikaans sentences...');
  const afrSentences = new Map<number, string>();
  const afrTsv = fs.readFileSync(path.join(TMP_DIR, 'afr_sentences.tsv'), 'utf-8');
  for (const line of afrTsv.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      afrSentences.set(parseInt(parts[0]), parts[2]);
    }
  }
  console.log(`  Loaded ${afrSentences.size} Afrikaans sentences`);

  // Load links: afrId → engId[]
  console.log('Loading Afrikaans-English links...');
  const links = new Map<number, number[]>();
  const neededEngIds = new Set<number>();
  const linksTsv = fs.readFileSync(path.join(TMP_DIR, 'afr-eng_links.tsv'), 'utf-8');
  for (const line of linksTsv.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const afrId = parseInt(parts[0]);
      const engId = parseInt(parts[1]);
      if (!links.has(afrId)) links.set(afrId, []);
      links.get(afrId)!.push(engId);
      neededEngIds.add(engId);
    }
  }
  console.log(`  Loaded ${links.size} linked Afrikaans sentences (${neededEngIds.size} English targets)`);

  // Load only the English sentences we need
  console.log('Loading English sentences (filtering to needed IDs)...');
  const engSentences = new Map<number, string>();
  const engTsv = fs.readFileSync(path.join(TMP_DIR, 'eng_sentences.tsv'), 'utf-8');
  for (const line of engTsv.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const id = parseInt(parts[0]);
      if (neededEngIds.has(id)) {
        engSentences.set(id, parts[2]);
      }
    }
  }
  console.log(`  Loaded ${engSentences.size} matching English sentences`);

  // Join and process
  console.log('\nProcessing sentence pairs...');
  const sentences: SentenceBankEntry[] = [];
  let skippedLength = 0;
  let skippedNoTranslation = 0;

  for (const [afrId, afrText] of afrSentences) {
    const engIds = links.get(afrId);
    if (!engIds || engIds.length === 0) {
      skippedNoTranslation++;
      continue;
    }

    // Find first available English translation
    let engText: string | undefined;
    for (const engId of engIds) {
      engText = engSentences.get(engId);
      if (engText) break;
    }
    if (!engText) {
      skippedNoTranslation++;
      continue;
    }

    // Check word count
    const wordCount = afrText.split(/\s+/).length;
    if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
      skippedLength++;
      continue;
    }

    // Find best cloze word
    const { word, index, rank } = findBestClozeWord(afrText);

    sentences.push({
      id: afrId,
      text: afrText,
      translation: engText,
      clozeWord: word,
      clozeIndex: index,
      wordRank: rank ?? null,
      collection: getCollectionForRank(rank),
    });
  }

  // Sort: ranked sentences first (by rank ascending), unranked at end
  sentences.sort((a, b) => {
    if (a.wordRank === null && b.wordRank === null) return 0;
    if (a.wordRank === null) return 1;
    if (b.wordRank === null) return -1;
    return a.wordRank - b.wordRank;
  });

  // Stats
  const collections = { top500: 0, top1000: 0, top2000: 0, random: 0 };
  for (const s of sentences) {
    collections[s.collection]++;
  }

  console.log('');
  console.log('=== Results ===');
  console.log(`Total sentence pairs: ${sentences.length}`);
  console.log(`Skipped (no English translation): ${skippedNoTranslation}`);
  console.log(`Skipped (too short/long): ${skippedLength}`);
  console.log(`Collections:`);
  console.log(`  top500:  ${collections.top500}`);
  console.log(`  top1000: ${collections.top1000}`);
  console.log(`  top2000: ${collections.top2000}`);
  console.log(`  random:  ${collections.random}`);

  // Write output
  const outputPath = path.resolve(__dirname, '../src/lib/sentence-bank.json');
  fs.writeFileSync(outputPath, JSON.stringify(sentences, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

  // Clean up temp files
  console.log('\nCleaning up temp files...');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
