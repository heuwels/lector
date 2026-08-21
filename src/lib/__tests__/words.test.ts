import { describe, it, expect } from 'vitest';
import { splitTrailingPunctuation, sentenceContainsWord } from '../words';
import { buildClozeText } from '../anki';
import { LANGUAGES } from '../languages';

const af = LANGUAGES.af;
const fr = LANGUAGES.fr;
const italian = LANGUAGES.it;
const nl = LANGUAGES.nl;
const ru = LANGUAGES.ru;

describe('splitTrailingPunctuation', () => {
  it('splits a single trailing mark', () => {
    expect(splitTrailingPunctuation('haar.')).toEqual(['haar', '.']);
    expect(splitTrailingPunctuation('sê!')).toEqual(['sê', '!']);
  });

  it('splits runs of trailing punctuation', () => {
    expect(splitTrailingPunctuation('word.,')).toEqual(['word', '.,']);
    expect(splitTrailingPunctuation('reg?"')).toEqual(['reg', '?"']);
  });

  it('returns clean words unchanged', () => {
    expect(splitTrailingPunctuation('hond')).toEqual(['hond', '']);
  });

  it("keeps the Afrikaans 'n contraction intact", () => {
    expect(splitTrailingPunctuation("'n")).toEqual(["'n", '']);
  });

  it('strips leading quotes/brackets (German „, parens) but not the apostrophe', () => {
    expect(splitTrailingPunctuation('„Sind')[0]).toBe('Sind');
    expect(splitTrailingPunctuation('(Haus)')[0]).toBe('Haus');
    expect(splitTrailingPunctuation("'n")[0]).toBe("'n");
  });

  it('strips leading Spanish inverted marks ¿ ¡', () => {
    expect(splitTrailingPunctuation('¿Cómo')[0]).toBe('Cómo');
    expect(splitTrailingPunctuation('¡Hola!')).toEqual(['Hola', '!']);
  });

  it('strips French guillemets but keeps an elided clitic token intact', () => {
    expect(splitTrailingPunctuation('«Où»')[0]).toBe('Où');
    expect(splitTrailingPunctuation('café.')).toEqual(['café', '.']);
    // WORD_PATTERN splits l'eau → l + eau at render time; splitTrailingPunctuation
    // itself only strips outer punctuation, so an apostrophe token survives here.
    expect(splitTrailingPunctuation("qu'il")).toEqual(["qu'il", '']);
  });

  it('keeps a Dutch apostrophe-plural and leading-apostrophe contraction intact', () => {
    expect(splitTrailingPunctuation("auto's")).toEqual(["auto's", '']);
    expect(splitTrailingPunctuation("foto's.")).toEqual(["foto's", '.']);
    // leading apostrophe survives, like the Afrikaans 'n
    expect(splitTrailingPunctuation("'t")).toEqual(["'t", '']);
  });

  it('keeps Italian elisions intact while stripping outer punctuation', () => {
    expect(splitTrailingPunctuation("L'acqua")).toEqual(["L'acqua", '']);
    expect(splitTrailingPunctuation("un'amica.")).toEqual(["un'amica", '.']);
    expect(splitTrailingPunctuation('«Caffè!»')).toEqual(['Caffè', '!»']);
  });

  it('strips Russian guillemets and trailing marks around Cyrillic words', () => {
    expect(splitTrailingPunctuation('«Привет!»')).toEqual(['Привет', '!»']);
    expect(splitTrailingPunctuation('ещё.')).toEqual(['ещё', '.']);
    expect(splitTrailingPunctuation('когда-нибудь,')).toEqual(['когда-нибудь', ',']);
  });

  it('strips Greek punctuation: ano teleia, erotimatiko, and comma', () => {
    expect(splitTrailingPunctuation('ζωή·')).toEqual(['ζωή', '·']);
    expect(splitTrailingPunctuation('Ἰουδαίων;')).toEqual(['Ἰουδαίων', ';']);
    expect(splitTrailingPunctuation('λόγος,')).toEqual(['λόγος', ',']);
  });
});

describe('sentenceContainsWord', () => {
  it('finds a word that appears as a token', () => {
    expect(sentenceContainsWord('Die vrugte is baie lekker.', 'vrugte', af)).toBe(true);
  });

  it('is case-insensitive both ways', () => {
    expect(sentenceContainsWord('Vrugte is lekker.', 'vrugte', af)).toBe(true);
    expect(sentenceContainsWord('die vrugte is lekker', 'Vrugte', af)).toBe(true);
  });

  it('rejects substring hits — sien is not in gesien (issue #106)', () => {
    expect(sentenceContainsWord('Ek het die katte gesien.', 'sien', af)).toBe(false);
    expect(sentenceContainsWord('Die vrugte is baie lekker.', 'vrug', af)).toBe(false);
  });

  it('matches through surrounding punctuation', () => {
    expect(sentenceContainsWord('Hy sê: "vrugte!"', 'vrugte', af)).toBe(true);
    expect(sentenceContainsWord('Die kat, die hond en die vis.', 'hond', af)).toBe(true);
  });

  it('keeps hyphenated words and diacritics intact', () => {
    expect(sentenceContainsWord('Ons gaan na die Klein-Karoo toe.', 'Klein-Karoo', af)).toBe(true);
    expect(sentenceContainsWord('Ons gaan na die Klein-Karoo toe.', 'Karoo', af)).toBe(false);
    expect(sentenceContainsWord('Wat sê jy?', 'sê', af)).toBe(true);
  });

  it('handles curly-quote wrapping', () => {
    expect(sentenceContainsWord('Hy skryf ‘vrug’ neer.', 'vrug', af)).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(sentenceContainsWord('', 'vrug', af)).toBe(false);
    expect(sentenceContainsWord('Die vrugte is lekker.', '', af)).toBe(false);
  });

  it("matches the Afrikaans 'n article as its own token", () => {
    expect(sentenceContainsWord("Dit is 'n mooi dag.", "'n", af)).toBe(true);
    expect(sentenceContainsWord('Die nag is donker.', "'n", af)).toBe(false);
  });

  it('matches decomposed input against precomposed text (NFC folding)', () => {
    const decomposed = 's' + 'e' + String.fromCharCode(0x0302); // \u0302 = combining circumflex
    expect(decomposed).not.toBe('s\u00EA');
    expect(sentenceContainsWord('Wat s\u00EA jy?', decomposed, af)).toBe(true);
  });

  it("finds the content word after a French elision (l'eau → eau)", () => {
    expect(sentenceContainsWord("L'eau est claire.", 'eau', fr)).toBe(true);
    expect(sentenceContainsWord("Je pense qu'il dort.", 'il', fr)).toBe(true);
    expect(sentenceContainsWord("J'aime le café.", 'aime', fr)).toBe(true);
    // a legacy multi-token target still matches as a consecutive token run
    expect(sentenceContainsWord("L'eau est claire.", "l'eau", fr)).toBe(true);
    // and a genuine substring is still rejected
    expect(sentenceContainsWord("L'eau est claire.", 'clair', fr)).toBe(false);
  });

  it('matches Dutch tokens: apostrophe plurals split, diacritics + ij intact', () => {
    // auto's → auto + s: the content stem is addressable as a whole token
    expect(sentenceContainsWord("Ik heb twee auto's.", 'auto', nl)).toBe(true);
    expect(sentenceContainsWord('De coördinatie is lastig.', 'coördinatie', nl)).toBe(true);
    expect(sentenceContainsWord('Het is een mooie ijsbeer.', 'ijsbeer', nl)).toBe(true);
    // a genuine substring is still rejected
    expect(sentenceContainsWord("Ik heb twee auto's.", 'aut', nl)).toBe(false);
  });

  it('matches Italian content words across elisions and preserves accents', () => {
    expect(sentenceContainsWord("L'acqua è fresca.", 'acqua', italian)).toBe(true);
    expect(sentenceContainsWord("Arriva un'amica.", 'amica', italian)).toBe(true);
    expect(sentenceContainsWord('Bevo il caffè.', 'caffè', italian)).toBe(true);
    expect(sentenceContainsWord("L'acqua è fresca.", 'acqu', italian)).toBe(false);
  });

  it('matches Russian tokens case-insensitively, keeping hyphenated compounds whole', () => {
    expect(sentenceContainsWord('Девочка купила молоко.', 'молоко', ru)).toBe(true);
    expect(sentenceContainsWord('«Привет!» — сказал он.', 'привет', ru)).toBe(true);
    expect(sentenceContainsWord('Он придёт когда-нибудь.', 'когда-нибудь', ru)).toBe(true);
    expect(sentenceContainsWord('Он придёт когда-нибудь.', 'нибудь', ru)).toBe(false);
    // a genuine substring is still rejected (дела is not in сделал)
    expect(sentenceContainsWord('Он сделал это вчера.', 'дела', ru)).toBe(false);
  });

  it('matches Turkish tokens through the dotted/dotless i fold', () => {
    const tr = LANGUAGES.tr;
    expect(sentenceContainsWord('İyi akşamlar dilerim.', 'iyi', tr)).toBe(true);
    expect(sentenceContainsWord('Işık söndü.', 'ışık', tr)).toBe(true);
    // A suffixed proper noun splits at the apostrophe, so the noun matches.
    expect(sentenceContainsWord("Dün İstanbul'da kaldım.", 'istanbul', tr)).toBe(true);
    // Dotted and dotless remain different words.
    expect(sentenceContainsWord('Işık söndü.', 'işik', tr)).toBe(false);
    // a genuine substring is still rejected
    expect(sentenceContainsWord('Kitabı okudum.', 'kitap', tr)).toBe(false);
  });

  it('matches Polish tokens through the default case fold', () => {
    const pl = LANGUAGES.pl;
    expect(sentenceContainsWord('Kupiłem nową książkę.', 'książkę', pl)).toBe(true);
    expect(sentenceContainsWord('Żółw jadł pączek.', 'żółw', pl)).toBe(true);
    // Hyphenated compounds stay whole.
    expect(sentenceContainsWord('To biało-czerwona flaga.', 'biało-czerwona', pl)).toBe(true);
    expect(sentenceContainsWord('To biało-czerwona flaga.', 'czerwona', pl)).toBe(false);
    // A foreign stem splits from its case ending, so the name matches.
    expect(sentenceContainsWord("Czytam Joyce'a teraz.", 'joyce', pl)).toBe(true);
    // a genuine substring is still rejected (książ is not a token of książkę)
    expect(sentenceContainsWord('Kupiłem nową książkę.', 'książ', pl)).toBe(false);
  });

  it('matches Czech tokens through the default case fold', () => {
    const cs = LANGUAGES.cs;
    expect(sentenceContainsWord('Koupil jsem novou knihu.', 'knihu', cs)).toBe(true);
    expect(sentenceContainsWord('Ten kůň běžel rychle.', 'kůň', cs)).toBe(true);
    expect(sentenceContainsWord('Příliš žluťoučký kůň.', 'žluťoučký', cs)).toBe(true);
    // Vowel length is contrastive: být (to be) is not byt (a flat).
    expect(sentenceContainsWord('Chci být doma.', 'byt', cs)).toBe(false);
    // Hyphenated compounds stay whole.
    expect(sentenceContainsWord('Je to česko-slovenský slovník.', 'česko-slovenský', cs)).toBe(
      true,
    );
    expect(sentenceContainsWord('Je to česko-slovenský slovník.', 'slovenský', cs)).toBe(false);
    // a genuine substring is still rejected (kni is not a token of knihu)
    expect(sentenceContainsWord('Koupil jsem novou knihu.', 'kni', cs)).toBe(false);
  });

  it('matches Indonesian tokens, including a reduplicated plural', () => {
    const id = LANGUAGES.id;
    expect(sentenceContainsWord('Saya membeli buku baru.', 'membeli', id)).toBe(true);
    expect(sentenceContainsWord('Mereka membaca buku-buku itu.', 'buku-buku', id)).toBe(true);
    expect(sentenceContainsWord('Mereka membaca buku-buku itu.', 'buku', id)).toBe(false);
    expect(sentenceContainsWord('Saya membeli buku baru.', 'beli', id)).toBe(false);
  });

  it('matches Swedish tokens through the default case fold', () => {
    const sv = LANGUAGES.sv;
    expect(sentenceContainsWord('Jag köpte en ny bok.', 'bok', sv)).toBe(true);
    expect(sentenceContainsWord('Här är en röd björn.', 'björn', sv)).toBe(true);
    expect(sentenceContainsWord('Hon läste tidningen.', 'tidningen', sv)).toBe(true);
    expect(sentenceContainsWord('Jag köpte en ny bok.', 'bo', sv)).toBe(false);
  });

  it('matches a Ukrainian apostrophe word as one token, in any variant', () => {
    const uk = LANGUAGES.uk;
    expect(sentenceContainsWord("Я з'їв п'ять яблук.", "п'ять", uk)).toBe(true);
    // The sentence and the target may spell the apostrophe differently.
    expect(sentenceContainsWord('Я з’їв п’ять яблук.', "п'ять", uk)).toBe(true);
    expect(sentenceContainsWord("Я з'їв п'ять яблук.", 'п’ять', uk)).toBe(true);
    // Neither half of the word is a token of its own any more.
    expect(sentenceContainsWord("Я з'їв п'ять яблук.", 'ять', uk)).toBe(false);
    expect(sentenceContainsWord("Я з'їв п'ять яблук.", 'п', uk)).toBe(false);
    // Hyphenated compounds stay whole, as for ru.
    expect(sentenceContainsWord('Це будь-який день.', 'будь-який', uk)).toBe(true);
    // a genuine substring is still rejected
    expect(sentenceContainsWord('Вона читала книгу.', 'книг', uk)).toBe(false);
  });

  it('matches polytonic Greek tokens with marks intact', () => {
    const grc = LANGUAGES.grc;
    expect(sentenceContainsWord('Ἐν ἀρχῇ ἦν ὁ λόγος.', 'λόγος', grc)).toBe(true);
    expect(sentenceContainsWord('Ἐν ἀρχῇ ἦν ὁ λόγος.', 'ἀρχῇ', grc)).toBe(true);
    // the elided κατ᾽ arrives pre-split, so the fragment is addressable
    expect(sentenceContainsWord('καὶ κατ᾽ αὐτόν ἔρχεται.', 'αὐτόν', grc)).toBe(true);
    // a genuine substring is still rejected
    expect(sentenceContainsWord('Ἐν ἀρχῇ ἦν ὁ λόγος.', 'λόγ', grc)).toBe(false);
  });
});

describe('buildClozeText', () => {
  it('builds a cloze for a bank word with trailing punctuation (issue #108)', () => {
    // "gelees." as stored in the bank previously produced \bgelees\.\b, which
    // never matches — the note had no {{c1::}} and AnkiConnect rejected it.
    expect(buildClozeText('Hy het die boek gelees.', 'gelees.')).toBe(
      'Hy het die boek {{c1::gelees}}.',
    );
  });

  it('keeps punctuation outside the blank for mid-sentence words', () => {
    expect(buildClozeText('Sy het haar boek gelees.', 'haar.')).toBe(
      'Sy het {{c1::haar}} boek gelees.',
    );
  });

  it('preserves the original casing via the capture group', () => {
    expect(buildClozeText('Haar boek is hier.', 'haar.')).toBe('{{c1::Haar}} boek is hier.');
  });

  it('returns the sentence unchanged when the word is absent', () => {
    expect(buildClozeText('Geen ooreenkoms hier nie.', 'afwesig')).toBe(
      'Geen ooreenkoms hier nie.',
    );
  });

  // #289 4.7 — mirrors api/src/lib/anki.test.ts. Keep the two in step.
  describe('unspaced CJK blanks by token span', () => {
    const zh = LANGUAGES.zh;

    it('blanks a word mid-sentence, at the start, and at the end', () => {
      expect(buildClozeText('我喜欢读书。', '喜欢', zh)).toBe('我{{c1::喜欢}}读书。');
      expect(buildClozeText('喜欢读书。', '喜欢', zh)).toBe('{{c1::喜欢}}读书。');
      expect(buildClozeText('我喜欢', '喜欢', zh)).toBe('我{{c1::喜欢}}');
    });

    it('blanks every occurrence', () => {
      expect(buildClozeText('我喜欢，他也喜欢。', '喜欢', zh)).toBe(
        '我{{c1::喜欢}}，他也{{c1::喜欢}}。',
      );
    });

    it('never blanks a fragment of a token', () => {
      expect(buildClozeText('我喜欢读书。', '喜', zh)).toBe('我喜欢读书。');
    });

    it('matches a run of tokens when the segmenters disagree', () => {
      expect(buildClozeText('我喜欢读书。', '喜欢读书', zh)).toBe('我{{c1::喜欢读书}}。');
    });

    it('produces no blank without a pack, which is why the argument exists', () => {
      expect(buildClozeText('我喜欢读书。', '喜欢')).not.toContain('{{c1::');
    });
  });
});
