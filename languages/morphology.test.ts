import { describe, it, expect } from 'vitest';

import { stemCandidates, vocabKeys } from './morphology';
import { LANGUAGES } from './registry';
import type { MorphologyConfig } from './types';

const ko = LANGUAGES.ko.morphology as MorphologyConfig;

function keys(word: string, config: MorphologyConfig = ko): string[] {
  return stemCandidates(word, config).map((c) => c.key);
}

describe('stemCandidates', () => {
  it('peels one postposition off a noun', () => {
    expect(keys('도서관에서')).toContain('도서관');
    expect(keys('학생이')).toContain('학생');
    expect(keys('것을')).toContain('것');
  });

  it('takes the longest postposition first at each step', () => {
    // 에게서 and 에 both end 학생에게서, and only 학생 is the word.
    expect(keys('학생에게서')[0]).toBe('학생');
  });

  it('peels a stack, shallow before deep', () => {
    const all = keys('도서관에서는');
    expect(all[0]).toBe('도서관에서');
    expect(all).toContain('도서관');
    expect(all.indexOf('도서관에서')).toBeLessThan(all.indexOf('도서관'));
  });

  it('stops at maxClitics', () => {
    // 은, 에서, 의 would be three peels to reach 도서관.
    expect(keys('도서관의에서은')).not.toContain('도서관');
  });

  it('leaves a one-syllable stem, which Korean needs', () => {
    expect(keys('집에')).toContain('집');
    expect(keys('눈은')).toContain('눈');
  });

  it('never proposes an empty key', () => {
    // A bare postposition peels to nothing, and minStem is what stops it.
    expect(keys('은')).toEqual([]);
    for (const word of ['에서', '이다', '입니다', '들', '도서관에서는']) {
      expect(keys(word).every((key) => key.length > 0)).toBe(true);
    }
  });

  it('appends the citation suffix after an ending, not after a postposition', () => {
    // 좋아하지 is the stem 좋아하 plus 지, and 좋아하다 is the entry.
    expect(keys('좋아하지')).toContain('좋아하다');
    // 도서관에서 is a finished word plus a postposition, so no 다 is appended.
    expect(keys('도서관에서')).not.toContain('도서관다');
  });

  it('resolves the copula on a noun', () => {
    expect(keys('사람입니다')).toContain('사람');
    expect(keys('사람이에요')).toContain('사람');
    expect(keys('사람이야')).toContain('사람');
  });

  it('proposes postpositions before endings', () => {
    // 은 is both a postposition and an adnominal ending, so 좋은 offers the bare
    // 좋 and 좋다 both. The postposition reading comes first, and the caller is
    // what decides.
    const all = keys('좋은');
    expect(all).toContain('좋');
    expect(all).toContain('좋다');
    expect(all.indexOf('좋')).toBeLessThan(all.indexOf('좋다'));
  });

  it('proposes each key once', () => {
    const all = keys('학생이나');
    expect(new Set(all).size).toBe(all.length);
  });

  it('appends nothing for a pack that declares no endings', () => {
    const noEndings: MorphologyConfig = { clitics: ['에'], maxClitics: 1, minStem: 1 };
    expect(keys('집에', noEndings)).toEqual(['집']);
  });

  it('resolves the plural under a postposition', () => {
    expect(keys('학생들은')).toContain('학생');
  });

  it('records what it peeled, innermost first', () => {
    const stacked = stemCandidates('도서관에서는', ko);
    expect(stacked[0].peeled).toEqual(['는']);
    expect(stacked.find((c) => c.key === '도서관')?.peeled).toEqual(['는', '에서']);
  });
});

const id = LANGUAGES.id.morphology as MorphologyConfig;

describe('Indonesian stemCandidates', () => {
  it('peels a possessive clitic', () => {
    expect(keys('namanya', id)).toContain('nama');
    expect(keys('bukuku', id)).toContain('buku');
  });

  it('peels a voice prefix', () => {
    expect(keys('membeli', id)).toContain('beli');
    expect(keys('bertahan', id)).toContain('tahan');
    expect(keys('mengalami', id)).toContain('alami');
  });

  it('peels a clitic then a prefix', () => {
    expect(keys('membelinya', id)).toContain('beli');
  });

  it('takes the longest prefix first', () => {
    expect(keys('mengalami', id)[0]).toBe('alami');
  });
});

const italianMorph = LANGUAGES.it.morphology as MorphologyConfig;

describe('Italian stemCandidates', () => {
  it('peels an article elision from the content word', () => {
    expect(keys("l'italiano", italianMorph)).toContain('italiano');
    expect(keys("un'amica", italianMorph)).toContain('amica');
    expect(keys("dell'acqua", italianMorph)).toContain('acqua');
  });

  it('takes the longest elision prefix first', () => {
    expect(keys("dell'acqua", italianMorph)[0]).toBe('acqua');
    expect(keys("dell'acqua", italianMorph)).not.toContain("ell'acqua");
  });

  it('peels a clitic elision from a verb', () => {
    expect(keys("gliel'ho", italianMorph)).toContain('ho');
    expect(keys("c'è", italianMorph)).toContain('è');
    expect(keys("dov'è", italianMorph)).toContain('è');
    expect(keys("cos'è", italianMorph)).toContain('è');
  });
});

const arabicMorph = LANGUAGES.ar.morphology as MorphologyConfig;

describe('Arabic stemCandidates (#253)', () => {
  it('peels one proclitic', () => {
    expect(keys('وكتاب', arabicMorph)).toContain('كتاب');
    expect(keys('بقلم', arabicMorph)).toContain('قلم');
    expect(keys('الكتاب', arabicMorph)).toContain('كتاب');
  });

  it('peels a stack of three proclitics', () => {
    // و + ب + ال + قلم. This is the case a one-pass peel cannot reach: it
    // answers بالقلم, which is not a key.
    expect(keys('وبالقلم', arabicMorph)).toContain('قلم');
  });

  it('peels the fused لل, which is ل + ال with the alef elided', () => {
    expect(keys('للمدرسة', arabicMorph)).toContain('مدرسة');
    expect(keys('وللمدرسة', arabicMorph)).toContain('مدرسة');
  });

  it('peels a pronoun enclitic', () => {
    expect(keys('كتابه', arabicMorph)).toContain('كتاب');
    expect(keys('كتابها', arabicMorph)).toContain('كتاب');
    expect(keys('بيتنا', arabicMorph)).toContain('بيت');
  });

  it('peels an enclitic and a proclitic together', () => {
    expect(keys('وكتابه', arabicMorph)).toContain('كتاب');
    expect(keys('بكتابها', arabicMorph)).toContain('كتاب');
  });

  it('offers the shallowest peel first', () => {
    // Least work to explain wins, so a reader is told "و form of" before it is
    // told "و + ب + ال form of".
    const candidates = keys('وبالقلم', arabicMorph);
    expect(candidates.indexOf('بالقلم')).toBeLessThan(candidates.indexOf('قلم'));
  });

  it('leaves a two-letter stem, which a three-letter floor would refuse', () => {
    // The commonest shape in the language: a proclitic on a function word.
    expect(keys('وهو', arabicMorph)).toContain('هو');
    expect(keys('ومن', arabicMorph)).toContain('من');
    expect(keys('ففي', arabicMorph)).toContain('في');
    expect(keys('بكل', arabicMorph)).toContain('كل');
  });

  it('never peels a stem below two letters', () => {
    for (const key of keys('في', arabicMorph)) expect(key.length).toBeGreaterThanOrEqual(2);
    for (const key of keys('وفي', arabicMorph)) expect(key.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Scottish Gaelic mutations', () => {
  const gdMorph: MorphologyConfig = {
    clitics: [],
    maxClitics: 0,
    minStem: 2,
    prefixes: ['h-', 't-'],
    mutations: [
      { from: 'bh', to: 'b' },
      { from: 'ch', to: 'c' },
      { from: 'dh', to: 'd' },
      { from: 'fh', to: 'f' },
      { from: 'gh', to: 'g' },
      { from: 'mh', to: 'm' },
      { from: 'ph', to: 'p' },
      { from: 'sh', to: 's' },
      { from: 'th', to: 't' },
    ],
  };

  it('undoes lenition at the front of the word', () => {
    expect(keys('bhean', gdMorph)).toContain('bean');
    expect(keys('chù', gdMorph)).toContain('cù');
    expect(keys('fhear', gdMorph)).toContain('fear');
    expect(keys('mhàthair', gdMorph)).toContain('màthair');
  });

  it('peels h- and t- prothesis', () => {
    expect(keys('h-obair', gdMorph)).toContain('obair');
    expect(keys('t-ainm', gdMorph)).toContain('ainm');
    expect(keys('t-sùil', gdMorph)).toContain('sùil');
  });

  it('records the surface start that it undid', () => {
    const hit = stemCandidates('bhean', gdMorph).find((c) => c.key === 'bean');
    expect(hit?.peeled).toEqual(['bh']);
  });

  it('does not propose a mutation when the surface is already the lemma', () => {
    expect(keys('bean', gdMorph)).toEqual([]);
  });

  it('still proposes a mutation for a word that is also a headword', () => {
    // tha is the copula. The lookup tries the exact key first, so this
    // proposal must not run until that miss. The function only proposes.
    expect(keys('tha', gdMorph)).toContain('ta');
  });
});

describe('maxPrefixes defaults to one pass', () => {
  it('does not stack prefixes for a pack that never asked to', () => {
    // id peels ONE voice prefix. `memberi` must not lose `mem` and then `beri`'s
    // own leading `ber`, which stacking would do.
    expect(LANGUAGES.id.morphology?.maxPrefixes).toBeUndefined();
    expect(keys('memberikan', id)).toContain('berikan');
    expect(keys('memberikan', id)).not.toContain('ikan');
  });
});

describe('vocabKeys', () => {
  it('puts the folded surface first, then the peeled stem', () => {
    expect(vocabKeys("l'acqua", LANGUAGES.it)).toEqual(["l'acqua", 'acqua']);
  });

  it('is just the folded word when the pack has no morphology', () => {
    expect(vocabKeys("l'eau", LANGUAGES.fr)).toEqual(["l'eau"]);
  });

  it('does not treat an Indonesian prefix peel as the same spelling', () => {
    expect(vocabKeys('membeli', LANGUAGES.id)).toEqual(['membeli']);
  });
});
