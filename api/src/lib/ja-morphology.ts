import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import path from 'path';
import { createRequire } from 'module';

/**
 * Japanese morphological analysis, for the stored word list of #289 4.2.
 *
 * Intl.Segmenter carries Japanese well enough for nouns and badly for verbs. It
 * knows noun boundaries and does not model verb morphology, so it severs a kanji
 * stem from its okurigana:
 *
 *   読んでいました   -> 読 | んで | いま | した
 *   食べられなかった -> 食 | べら | れ | なか | っ | た
 *
 * Neither 読 nor んで is a word, so no dictionary headword matches and the
 * reader prints no furigana above a verb. kuromoji models the grammar and
 * answers 読ん with its base form 読む, its reading ヨン, and the boundary in the
 * right place.
 *
 * It also reads a kanji IN CONTEXT, which no dictionary lookup can. 本 comes
 * back as ホン in 本を読む where the dictionary's standalone entry says もと.
 */

// Katakana to hiragana. kuromoji answers a reading in katakana, and furigana is
// written in hiragana for a kanji. The blocks are parallel, so one offset does
// it, and a character outside the block (a long vowel mark, punctuation) passes
// through.
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const TO_HIRAGANA = 0x3041 - KATAKANA_START;

export function katakanaToHiragana(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    out += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCodePoint(code + TO_HIRAGANA)
      : char;
  }
  return out;
}

export interface JaToken {
  /** The text as it appears, which is what the reader draws. */
  surface: string;
  /** Dictionary form, for a lookup. Equals `surface` when it does not inflect. */
  lemma: string;
  /** Reading in hiragana, or '' when kuromoji has none. */
  reading: string;
}

interface KuromojiToken {
  surface_form: string;
  basic_form?: string;
  reading?: string;
  pos?: string;
}
interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

// A missing value is '*' in the IPADIC columns, never an empty string.
const IPADIC_NULL = '*';

let tokenizer: KuromojiTokenizer | null = null;
let initFailed = false;

/**
 * Build the tokenizer, blocking, on first use.
 *
 * kuromoji's public builder is callback-based because it reads its dictionary
 * from disk. Every caller of the word list is synchronous, and several sit
 * inside a `db.transaction()`, so an async analyser would ripple through eight
 * call sites. Reading the dictionary synchronously instead makes `build()`
 * finish before it returns, measured at 232ms once per process.
 *
 * Lazy on purpose. The dictionary is 18MB on disk and the cost belongs to the
 * first Japanese import, not to every boot of every deployment.
 *
 * This reaches into the package's loader to do it, which is why the version is
 * pinned exactly. `ja-morphology.test.ts` fails loudly if that path moves.
 */
function getTokenizer(): KuromojiTokenizer | null {
  if (tokenizer || initFailed) return tokenizer;
  try {
    const require = createRequire(import.meta.url);
    const kuromoji = require('@sglkc/kuromoji');
    const NodeLoader = require('@sglkc/kuromoji/src/loader/NodeDictionaryLoader');
    const dicPath = path.join(
      path.dirname(require.resolve('@sglkc/kuromoji/package.json')),
      'dict',
    );

    NodeLoader.prototype.loadArrayBuffer = function (
      file: string,
      callback: (err: Error | null, buffer?: ArrayBuffer) => void,
    ) {
      try {
        const raw = gunzipSync(readFileSync(file));
        callback(null, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      } catch (err) {
        callback(err as Error);
      }
    };

    let built: KuromojiTokenizer | null = null;
    let buildError: Error | null = null;
    kuromoji
      .builder({ dicPath })
      .build((err: Error | null, instance: KuromojiTokenizer) => {
        buildError = err;
        built = instance;
      });
    if (buildError || !built) throw buildError ?? new Error('kuromoji built nothing');
    tokenizer = built;
    return tokenizer;
  } catch (err) {
    // A reader that loses furigana is far better than an import that fails, so
    // this degrades to Intl.Segmenter rather than throwing.
    initFailed = true;
    console.warn('[ja] morphological analyser unavailable, falling back to ICU:', err);
    return null;
  }
}

/** True when the analyser can run. Exposed for the tests and for callers that branch. */
export function japaneseAnalyserReady(): boolean {
  return getTokenizer() !== null;
}

/**
 * Analyse Japanese text, or return null when the analyser is unavailable.
 *
 * Punctuation and symbols are dropped: the caller wants words.
 */
export function analyseJapanese(text: string): JaToken[] | null {
  const instance = getTokenizer();
  if (!instance) return null;
  const out: JaToken[] = [];
  for (const token of instance.tokenize(text)) {
    // 記号 is the IPADIC part of speech for a symbol, which covers punctuation.
    if (token.pos === '記号') continue;
    const surface = token.surface_form;
    if (!surface) continue;
    const lemma =
      token.basic_form && token.basic_form !== IPADIC_NULL ? token.basic_form : surface;
    const reading =
      token.reading && token.reading !== IPADIC_NULL ? katakanaToHiragana(token.reading) : '';
    out.push({ surface, lemma, reading });
  }
  return out;
}
