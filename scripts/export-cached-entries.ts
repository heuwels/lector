/**
 * Dump the on-device AI translation cache (cached_entries / cached_senses /
 * cached_related_forms in lector.db) into a JSON patch that can be merged
 * into `src/lib/dictionary-roots.json` and rolled into the next dict release.
 *
 *   npx tsx scripts/export-cached-entries.ts > tmp/cached-patch.json
 *
 * Schema of the output mirrors dictionary-roots.json — one top-level object
 * keyed by the lowercase word, with translation/partOfSpeech stitched from
 * the senses table. The hand-curated review step is intentional: cached
 * entries are user-validated but not yet vetted for canonical inclusion.
 */
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'lector.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`No lector.db at ${DB_PATH}. Nothing to export.`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

interface EntryRow {
  word: string;
  ipa: string | null;
  etymology: string | null;
}

interface RootJsonEntry {
  rank: number;
  translation: string;
  partOfSpeech: string;
  ipa?: string;
  etymology?: string;
}

const entries = db.prepare('SELECT word, ipa, etymology FROM cached_entries ORDER BY word').all() as EntryRow[];
const senseStmt = db.prepare('SELECT pos, gloss FROM cached_senses WHERE word = ? ORDER BY sort_order');

const out: Record<string, RootJsonEntry> = {};
let skipped = 0;

for (const row of entries) {
  const senses = senseStmt.all(row.word) as Array<{ pos: string | null; gloss: string }>;
  if (senses.length === 0) {
    skipped++;
    continue;
  }
  const translation = senses.map((s) => s.gloss).filter(Boolean).join('; ');
  const partOfSpeech = senses[0]?.pos || '';
  const entry: RootJsonEntry = {
    rank: 0,
    translation,
    partOfSpeech,
  };
  if (row.ipa) entry.ipa = row.ipa;
  if (row.etymology) entry.etymology = row.etymology;
  out[row.word] = entry;
}

process.stdout.write(JSON.stringify(out, null, 2));
process.stdout.write('\n');

console.error(`Exported ${Object.keys(out).length} cached entries (${skipped} skipped: no senses).`);
console.error('To merge: paste into src/lib/dictionary-roots.json, run `npx tsx scripts/build-dictionary.ts`, then re-publish via scripts/release-dict.sh.');
