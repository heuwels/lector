import { describe, expect, it } from 'vitest';
import { isLingQHeader, parseCSV, parseLingQExport } from './utils';

const lower = (w: string) => w.toLowerCase();

describe('parseCSV', () => {
  it('keeps commas, escaped quotes, and line breaks inside quoted fields', () => {
    const rows = parseCSV('a,"b, c","say ""hi"""\r\n"multi\nline",x\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['multi\nline', 'x'],
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCSV('\n\na\n\n b \n')).toEqual([['a'], ['b']]);
  });
});

describe('isLingQHeader', () => {
  it('matches whole header cells only', () => {
    expect(isLingQHeader(['term', 'phrase'])).toBe(true);
    expect(isLingQHeader(['determine'])).toBe(false);
  });
});

describe('parseLingQExport', () => {
  it('maps the LingQ site export: phrase is the sentence, meaningN is the translation', () => {
    const csv = [
      'term,phrase,tag1,tag2,tag3,tag4,tag5,tag6,tag7,tag8,tag9,tag10,tag11,tag12,meaninglanguage1,meaning1,meaninglanguage2,meaning2',
      'À,Apprenez à partir de contenus qui...,Adverb,Preposition,préposition,adverbe,,,,,,,,,en,"to, at, in {preposition} about, upon, with, by ;",en,towards',
      'Il y a,"Il y a deux chats.",,,,,,,,,,,,,en,there is,,',
    ].join('\n');

    expect(parseLingQExport(parseCSV(csv), lower)).toEqual([
      {
        word: 'à',
        type: 'word',
        state: 'level1',
        translation: 'to, at, in {preposition} about, upon, with, by ;; towards',
        sentence: 'Apprenez à partir de contenus qui...',
      },
      {
        word: 'il y a',
        type: 'phrase',
        state: 'level1',
        translation: 'there is',
        sentence: 'Il y a deux chats.',
      },
    ]);
  });

  it('maps the term, hint, status, sentence layout', () => {
    const csv = [
      '"term","hint","status","sentence"',
      '"16 e","16th","1","Le 16e, le 7e..."',
      '"a","has","K","Il a congé pendant l\'hiver."',
    ].join('\n');

    expect(parseLingQExport(parseCSV(csv), lower)).toEqual([
      {
        word: '16 e',
        type: 'phrase',
        state: 'level1',
        translation: '16th',
        sentence: 'Le 16e, le 7e...',
      },
      {
        word: 'a',
        type: 'word',
        state: 'known',
        translation: 'has',
        sentence: "Il a congé pendant l'hiver.",
      },
    ]);
  });

  it('skips rows without a term and returns null without a term column', () => {
    expect(parseLingQExport(parseCSV('term,hint\n,orphan\nhuis,house'), lower)).toHaveLength(1);
    expect(parseLingQExport(parseCSV('hint,status\nhouse,1'), lower)).toBeNull();
  });
});
