/**
 * Transforms flat dictionary-data.json into root-based structure.
 *
 * Output format:
 * {
 *   "staan": {
 *     "rank": 42,
 *     "translation": "to stand",
 *     "partOfSpeech": "verb",
 *     "prefixes": {
 *       "ver": { "rank": 100, "translation": "understand" },
 *       "be": { "rank": 200, "translation": "exist", "partOfSpeech": "noun" }
 *     },
 *     "suffixes": {
 *       "e": { "rank": 300, "translation": "stands (plural)" }
 *     }
 *   }
 * }
 *
 * Run: npx tsx scripts/build-root-dictionary.ts
 */

import fs from 'fs';
import path from 'path';

interface FlatEntry {
  word: string;
  rank: number;
  translation: string;
  partOfSpeech: string;
}

interface DerivedEntry {
  rank: number;
  translation: string;
  partOfSpeech?: string; // only if different from root
}

interface RootEntry {
  rank: number;
  translation: string;
  partOfSpeech: string;
  prefixes?: Record<string, DerivedEntry>;
  suffixes?: Record<string, DerivedEntry>;
}

const PREFIXES = ['ont', 'ver', 'her', 'ge', 'be'];
const SUFFIXES = ['heid', 'tjie', 'jie', 'ing', 'lik', 'te', 'de', 'e', 's'];
const VOWELS = new Set('aeiouyêëéèôöûüîïáà'.split(''));
const MIN_STEM = 2;

function undoubleConsonant(stem: string): string | null {
  if (stem.length >= 3) {
    const last = stem[stem.length - 1];
    const prev = stem[stem.length - 2];
    if (last === prev && !VOWELS.has(last)) {
      return stem.slice(0, -1);
    }
  }
  return null;
}

const dataPath = path.join(__dirname, '../src/lib/dictionary-data.json');
const data: FlatEntry[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Build word→entry lookup
const entryMap = new Map<string, FlatEntry>();
for (const e of data) {
  entryMap.set(e.word.toLowerCase(), e);
}

// Track which words get nested (so we don't keep them as roots too)
const nested = new Set<string>();

// Track derivation relationships: rootWord → [{ word, type, affix }]
interface Derivation {
  word: string;
  type: 'prefix' | 'suffix';
  affix: string;
  root: string; // the actual root word matched
}

// False positives: words that structurally match prefix+root or root+suffix
// but are etymologically unrelated. Keep these as standalone root entries.
const EXCLUDE = new Set([
  // Prefix false positives
  'been',     // leg/bone, not be- + en
  'geen',     // no/none, not ge- + en
  'geweer',   // rifle, not ge- + weer
  'gebed',    // prayer, not ge- + bed
  'bevel',    // command, not be- + vel
  'geval',    // case, not ge- + val
  'gesin',    // family, not ge- + sin
  'veral',    // especially, not ver- + al
  'verhaal',  // tale, not ver- + haal
  'verhoog',  // stage, not ver- + hoog
  'ontrou',   // unfaithful, not ont- + rou
  // Suffix false positives
  'tee',      // tea, not te + -e
  'ses',      // six, not se + -s
  'see',      // sea, not se + -e
  'dans',     // dance, not dan + -s
  'gees',     // spirit, not gee + -s
  'sonde',    // sin, not son + -de
  'vals',     // false, not val + -s
  'hele',     // whole, not hel + -e
  'jas',      // jacket, not ja + -s
  'selde',    // seldom, not sel + -de
  'soms',     // sometimes, not som + -s
  'hulle',    // they/them, not hul + -e
  'selfs',    // even, not self + -s
  'slegs',    // only, not sleg + -s
]);

const derivations: Derivation[] = [];

for (const entry of data) {
  const w = entry.word.toLowerCase();
  if (EXCLUDE.has(w)) continue;

  // Try prefix stripping
  for (const p of PREFIXES) {
    if (w.startsWith(p)) {
      const stem = w.slice(p.length);
      if (stem.length >= MIN_STEM && entryMap.has(stem)) {
        derivations.push({ word: w, type: 'prefix', affix: p, root: stem });
        break; // take first prefix match (longest prefixes are first)
      }
    }
  }

  // Try suffix stripping
  for (const s of SUFFIXES) {
    if (w.endsWith(s)) {
      const stem = w.slice(0, -s.length);

      if (stem.length >= MIN_STEM && entryMap.has(stem)) {
        derivations.push({ word: w, type: 'suffix', affix: s, root: stem });
        break;
      }

      // Try consonant undoubling
      const undoubled = undoubleConsonant(stem);
      if (undoubled && undoubled.length >= MIN_STEM && entryMap.has(undoubled)) {
        derivations.push({ word: w, type: 'suffix', affix: s, root: undoubled });
        break;
      }
    }
  }
}

// A word that is itself the root of other derivations should NOT be nested
const rootsOfOthers = new Set(derivations.map((d) => d.root));

// Filter: don't nest words that are roots for other derivations
const validDerivations = derivations.filter((d) => !rootsOfOthers.has(d.word));

for (const d of validDerivations) {
  nested.add(d.word);
}

// Build the root-based dictionary
const rootDict: Record<string, RootEntry> = {};

// First pass: add all root entries (entries not nested under another)
for (const entry of data) {
  const w = entry.word.toLowerCase();
  if (nested.has(w)) continue;

  rootDict[w] = {
    rank: entry.rank,
    translation: entry.translation,
    partOfSpeech: entry.partOfSpeech,
  };
}

// Second pass: nest derivations under their roots
for (const d of validDerivations) {
  const root = rootDict[d.root];
  if (!root) continue; // safety check

  const derivedEntry = entryMap.get(d.word)!;
  const derived: DerivedEntry = {
    rank: derivedEntry.rank,
    translation: derivedEntry.translation,
  };

  // Only include POS if different from root
  if (derivedEntry.partOfSpeech !== root.partOfSpeech) {
    derived.partOfSpeech = derivedEntry.partOfSpeech;
  }

  if (d.type === 'prefix') {
    if (!root.prefixes) root.prefixes = {};
    root.prefixes[d.affix] = derived;
  } else {
    if (!root.suffixes) root.suffixes = {};
    root.suffixes[d.affix] = derived;
  }
}

// Write output
const outPath = path.join(__dirname, '../src/lib/dictionary-roots.json');
fs.writeFileSync(outPath, JSON.stringify(rootDict, null, 2));

// Stats
const rootCount = Object.keys(rootDict).length;
let prefixCount = 0;
let suffixCount = 0;
for (const entry of Object.values(rootDict)) {
  prefixCount += Object.keys(entry.prefixes || {}).length;
  suffixCount += Object.keys(entry.suffixes || {}).length;
}

console.log(`Root entries: ${rootCount}`);
console.log(`Prefix derivations nested: ${prefixCount}`);
console.log(`Suffix derivations nested: ${suffixCount}`);
console.log(`Total words covered: ${rootCount + prefixCount + suffixCount}`);
console.log(`Slots freed: ${data.length - rootCount} (available for new roots)`);
console.log(`\nWritten to: ${outPath}`);
