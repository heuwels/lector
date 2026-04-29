/**
 * Expands dictionary-roots.json with new root entries.
 * Run: npx tsx scripts/expand-dictionary.ts
 */
import fs from 'fs';
import path from 'path';

interface DerivedEntry {
  rank: number;
  translation: string;
  partOfSpeech?: string;
}

interface RootEntry {
  rank: number;
  translation: string;
  partOfSpeech: string;
  prefixes?: Record<string, DerivedEntry>;
  suffixes?: Record<string, DerivedEntry>;
}

// New words to add — sourced from user's reading corpus + common Afrikaans gaps
// rank: 0 = unranked (not in original top-2000 frequency list)
const NEW_WORDS: { word: string; translation: string; partOfSpeech: string }[] = [
  // High frequency in reading corpus (>50 occurrences)
  { word: 'dis', translation: "it is/that's", partOfSpeech: 'contraction' },
  { word: 'oom', translation: 'uncle/sir', partOfSpeech: 'noun' },
  { word: 'want', translation: 'because/for', partOfSpeech: 'conjunction' },
  { word: 'lyk', translation: 'seem/look/corpse', partOfSpeech: 'verb' },
  { word: 'alles', translation: 'everything', partOfSpeech: 'pronoun' },
  { word: 'tog', translation: 'yet/still/after all', partOfSpeech: 'adverb' },
  { word: 'julle', translation: 'you (plural)', partOfSpeech: 'pronoun' },
  { word: 'almal', translation: 'everyone', partOfSpeech: 'pronoun' },
  { word: 'keer', translation: 'time/turn/prevent', partOfSpeech: 'noun' },
  { word: 'lang', translation: 'long/tall', partOfSpeech: 'adjective' },
  { word: 'alleen', translation: 'alone/only', partOfSpeech: 'adverb' },
  { word: 'vas', translation: 'firm/stuck/fast', partOfSpeech: 'adjective' },
  { word: 'veld', translation: 'field/bush/veld', partOfSpeech: 'noun' },
  { word: 'ag', translation: 'oh/eight', partOfSpeech: 'interjection' },
  { word: 'ma', translation: 'mother/mom', partOfSpeech: 'noun' },
  { word: 'tant', translation: 'aunt/ma\'am', partOfSpeech: 'noun' },
  { word: 'staar', translation: 'stare', partOfSpeech: 'verb' },
  { word: 'iemand', translation: 'someone', partOfSpeech: 'pronoun' },
  { word: 'taal', translation: 'language', partOfSpeech: 'noun' },
  { word: 'wel', translation: 'well/indeed', partOfSpeech: 'adverb' },
  { word: 'volk', translation: 'nation/people', partOfSpeech: 'noun' },
  { word: 'mekaar', translation: 'each other', partOfSpeech: 'pronoun' },
  { word: 'dié', translation: 'this/these', partOfSpeech: 'determiner' },
  { word: 'niemand', translation: 'nobody/no one', partOfSpeech: 'pronoun' },
  { word: 'raak', translation: 'touch/become/get', partOfSpeech: 'verb' },
  { word: 'pa', translation: 'father/dad', partOfSpeech: 'noun' },
  { word: 'verdwyn', translation: 'disappear', partOfSpeech: 'verb' },
  { word: 'jare', translation: 'years', partOfSpeech: 'noun' },
  { word: 'moes', translation: 'had to/must (past)', partOfSpeech: 'verb' },
  { word: 'asof', translation: 'as if', partOfSpeech: 'conjunction' },
  { word: 'steek', translation: 'stab/sting/put', partOfSpeech: 'verb' },
  { word: 'sterre', translation: 'stars', partOfSpeech: 'noun' },
  { word: 'daarvan', translation: 'of it/thereof', partOfSpeech: 'adverb' },
  { word: 'skyn', translation: 'shine/seem', partOfSpeech: 'verb' },
  { word: 'neer', translation: 'down', partOfSpeech: 'adverb' },
  { word: 'half', translation: 'half', partOfSpeech: 'adjective' },
  { word: 'luister', translation: 'listen', partOfSpeech: 'verb' },
  { word: 'veel', translation: 'much/many', partOfSpeech: 'adverb' },
  { word: 'blink', translation: 'shine/bright', partOfSpeech: 'verb' },
  { word: 'droom', translation: 'dream', partOfSpeech: 'noun' },
  { word: 'gebeur', translation: 'happen', partOfSpeech: 'verb' },
  { word: 'mee', translation: 'with/along', partOfSpeech: 'adverb' },
  { word: 'glimlag', translation: 'smile', partOfSpeech: 'noun' },
  { word: 'gang', translation: 'corridor/pace', partOfSpeech: 'noun' },
  { word: 'mos', translation: 'after all/surely', partOfSpeech: 'adverb' },
  { word: 'aarde', translation: 'earth/ground', partOfSpeech: 'noun' },
  { word: 'kleur', translation: 'colour', partOfSpeech: 'noun' },
  { word: 'ore', translation: 'ears', partOfSpeech: 'noun' },
  { word: 'slang', translation: 'snake', partOfSpeech: 'noun' },
  { word: 'verskyn', translation: 'appear', partOfSpeech: 'verb' },
  { word: 'middel', translation: 'middle/waist', partOfSpeech: 'noun' },
  { word: 'meisie', translation: 'girl', partOfSpeech: 'noun' },
  { word: 'geniet', translation: 'enjoy', partOfSpeech: 'verb' },
  { word: 'ontdek', translation: 'discover', partOfSpeech: 'verb' },
  { word: 'eis', translation: 'demand/claim', partOfSpeech: 'verb' },
  { word: 'ouma', translation: 'grandmother', partOfSpeech: 'noun' },
  { word: 'verdien', translation: 'earn/deserve', partOfSpeech: 'verb' },
  { word: 'oupa', translation: 'grandfather', partOfSpeech: 'noun' },
  { word: 'brug', translation: 'bridge', partOfSpeech: 'noun' },
  { word: 'baba', translation: 'baby', partOfSpeech: 'noun' },
  { word: 'blad', translation: 'leaf/page', partOfSpeech: 'noun' },
  { word: 'vlees', translation: 'meat/flesh', partOfSpeech: 'noun' },
  { word: 'berei', translation: 'prepare', partOfSpeech: 'verb' },
  { word: 'skaap', translation: 'sheep', partOfSpeech: 'noun' },
  { word: 'hoender', translation: 'chicken', partOfSpeech: 'noun' },
  { word: 'sowat', translation: 'about/approximately', partOfSpeech: 'adverb' },
  { word: 'bely', translation: 'confess', partOfSpeech: 'verb' },
  { word: 'koei', translation: 'cow', partOfSpeech: 'noun' },
  // Additional common words not in corpus but useful
  { word: 'later', translation: 'later', partOfSpeech: 'adverb' },
  { word: 'seun', translation: 'boy/son', partOfSpeech: 'noun' },
  { word: 'oggend', translation: 'morning', partOfSpeech: 'noun' },
  { word: 'nag', translation: 'night', partOfSpeech: 'noun' },
  { word: 'dorp', translation: 'town/village', partOfSpeech: 'noun' },
  { word: 'reën', translation: 'rain', partOfSpeech: 'noun' },
  { word: 'pad', translation: 'road/path', partOfSpeech: 'noun' },
  { word: 'kamer', translation: 'room', partOfSpeech: 'noun' },
  { word: 'plek', translation: 'place/spot', partOfSpeech: 'noun' },
  { word: 'voel', translation: 'feel', partOfSpeech: 'verb' },
  { word: 'brief', translation: 'letter', partOfSpeech: 'noun' },
  { word: 'paar', translation: 'pair/few/couple', partOfSpeech: 'noun' },
  { word: 'uur', translation: 'hour', partOfSpeech: 'noun' },
  { word: 'maand', translation: 'month', partOfSpeech: 'noun' },
  { word: 'maal', translation: 'time/grind', partOfSpeech: 'noun' },
  { word: 'niks', translation: 'nothing', partOfSpeech: 'pronoun' },
  { word: 'bietjie', translation: 'a little/bit', partOfSpeech: 'adverb' },
  { word: 'buite', translation: 'outside', partOfSpeech: 'adverb' },
  { word: 'blom', translation: 'flower', partOfSpeech: 'noun' },
  { word: 'boom', translation: 'tree', partOfSpeech: 'noun' },
  { word: 'rivier', translation: 'river', partOfSpeech: 'noun' },
  { word: 'hemel', translation: 'heaven/sky', partOfSpeech: 'noun' },
  { word: 'brood', translation: 'bread', partOfSpeech: 'noun' },
  { word: 'suiker', translation: 'sugar', partOfSpeech: 'noun' },
  { word: 'sout', translation: 'salt', partOfSpeech: 'noun' },
  { word: 'kaas', translation: 'cheese', partOfSpeech: 'noun' },
  { word: 'botter', translation: 'butter', partOfSpeech: 'noun' },
  { word: 'appel', translation: 'apple', partOfSpeech: 'noun' },
  { word: 'lemoen', translation: 'orange', partOfSpeech: 'noun' },
  { word: 'wind', translation: 'wind', partOfSpeech: 'noun' },
  { word: 'klip', translation: 'rock/stone', partOfSpeech: 'noun' },
  { word: 'goud', translation: 'gold', partOfSpeech: 'noun' },
  { word: 'yster', translation: 'iron', partOfSpeech: 'noun' },
  { word: 'voël', translation: 'bird', partOfSpeech: 'noun' },
  { word: 'vis', translation: 'fish', partOfSpeech: 'noun' },
  { word: 'perd', translation: 'horse', partOfSpeech: 'noun' },
  { word: 'muis', translation: 'mouse', partOfSpeech: 'noun' },
  { word: 'genoeg', translation: 'enough', partOfSpeech: 'adverb' },
  { word: 'binne', translation: 'inside/within', partOfSpeech: 'adverb' },
  { word: 'wens', translation: 'wish', partOfSpeech: 'verb' },
  { word: 'antwoord', translation: 'answer', partOfSpeech: 'noun' },
  { word: 'probeer', translation: 'try/attempt', partOfSpeech: 'verb' },
  { word: 'soek', translation: 'search/look for', partOfSpeech: 'verb' },
  { word: 'draai', translation: 'turn/twist', partOfSpeech: 'verb' },
  { word: 'klim', translation: 'climb', partOfSpeech: 'verb' },
  { word: 'spring', translation: 'jump', partOfSpeech: 'verb' },
  { word: 'hardloop', translation: 'run', partOfSpeech: 'verb' },
  { word: 'vergeet', translation: 'forget', partOfSpeech: 'verb' },
  { word: 'besluit', translation: 'decide', partOfSpeech: 'verb' },
  { word: 'besoek', translation: 'visit', partOfSpeech: 'verb' },
  { word: 'beweeg', translation: 'move', partOfSpeech: 'verb' },
  { word: 'vermy', translation: 'avoid', partOfSpeech: 'verb' },
  { word: 'bedoel', translation: 'mean/intend', partOfSpeech: 'verb' },
  { word: 'donker', translation: 'dark', partOfSpeech: 'adjective' },
  { word: 'terug', translation: 'back', partOfSpeech: 'adverb' },
  { word: 'saam', translation: 'together', partOfSpeech: 'adverb' },
  { word: 'muur', translation: 'wall', partOfSpeech: 'noun' },
  { word: 'oop', translation: 'open', partOfSpeech: 'adjective' },
  { word: 'kop', translation: 'head/cup', partOfSpeech: 'noun' },
  { word: 'ryk', translation: 'rich/kingdom', partOfSpeech: 'adjective' },
  { word: 'vra', translation: 'ask', partOfSpeech: 'verb' },
  { word: 'rond', translation: 'round/around', partOfSpeech: 'adverb' },
  { word: 'nodig', translation: 'necessary/need', partOfSpeech: 'adjective' },
  { word: 'rustig', translation: 'calm/peaceful', partOfSpeech: 'adjective' },
  { word: 'naby', translation: 'near/close', partOfSpeech: 'adverb' },
  { word: 'trap', translation: 'stairs/kick', partOfSpeech: 'noun' },
  { word: 'kyk', translation: 'look/watch', partOfSpeech: 'verb' },
  { word: 'rug', translation: 'back (body)', partOfSpeech: 'noun' },
  { word: 'wag', translation: 'wait/guard', partOfSpeech: 'verb' },
];

const rootsPath = path.join(__dirname, '../src/lib/dictionary-roots.json');
const roots: Record<string, RootEntry> = JSON.parse(fs.readFileSync(rootsPath, 'utf-8'));

// Find the max rank used in existing entries
let maxRank = 0;
for (const entry of Object.values(roots)) {
  if (entry.rank > maxRank) maxRank = entry.rank;
  if (entry.prefixes) for (const d of Object.values(entry.prefixes)) if (d.rank > maxRank) maxRank = d.rank;
  if (entry.suffixes) for (const d of Object.values(entry.suffixes)) if (d.rank > maxRank) maxRank = d.rank;
}

let added = 0;
let skipped = 0;
let nextRank = maxRank + 1;

for (const w of NEW_WORDS) {
  const key = w.word.toLowerCase();
  if (roots[key]) {
    skipped++;
    continue;
  }
  roots[key] = {
    rank: nextRank++,
    translation: w.translation,
    partOfSpeech: w.partOfSpeech,
  };
  added++;
}

fs.writeFileSync(rootsPath, JSON.stringify(roots, null, 2));

console.log(`Added: ${added} new root entries`);
console.log(`Skipped: ${skipped} (already exist)`);
console.log(`Total roots: ${Object.keys(roots).length}`);

// Count total coverage
let prefixCount = 0;
let suffixCount = 0;
for (const entry of Object.values(roots)) {
  prefixCount += Object.keys(entry.prefixes || {}).length;
  suffixCount += Object.keys(entry.suffixes || {}).length;
}
console.log(`Total coverage: ${Object.keys(roots).length + prefixCount + suffixCount} words`);
