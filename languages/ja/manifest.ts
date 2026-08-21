// Japanese (#214). The reader needs no new code: #289 Phase 4 built the
// `cjk-unspaced` path for Chinese, and Intl.Segmenter splits Japanese through
// the same engine on `script.bcp47` alone.
//
// Nouns, adjectives, katakana and numerals hold up. 日本語, 図書館, 毎日, 東京,
// 楽しい and コーヒー all stay whole, and every particle is its own token, so a
// learner taps 日本語 and not 日本語を.
//
// A CONJUGATED VERB DOES NOT. ICU knows noun boundaries and does not model verb
// morphology, so it severs the kanji stem from its okurigana:
//
//   読んでいました   -> 読 | んで | いま | した
//   食べられなかった -> 食 | べら | れ | なか | っ | た
//   飲みます        -> 飲 | み | ます
//
// 読む survives, but only alone. This costs furigana most: `annotation` keys a
// reading on the folded span, no dictionary headword matches 読 or んで, and the
// reader prints nothing above a verb. Nouns still carry their reading.
//
// A lesson's stored word list (#289 4.2) overrides ICU at import time, and a
// morphological analyser is the fix. See #214 for that work.

// Japanese marks grammar with particles and auxiliaries rather than inflection,
// so those carry the sentence structure. Blanking one in a cloze asks the
// learner to guess syntax rather than vocabulary, and they stay out of the
// answer slot.
const AVOID_WORDS = new Set([
  // case particles
  'が',
  'を',
  'に',
  'で',
  'と',
  'へ',
  'から',
  'まで',
  'より',
  'の',
  // topic, focus and sentence-final particles
  'は',
  'も',
  'こそ',
  'しか',
  'だけ',
  'ばかり',
  'か',
  'ね',
  'よ',
  'な',
  'ぞ',
  'わ',
  'さ',
  // copula and its forms
  'だ',
  'です',
  'である',
  'でした',
  'じゃ',
  // the high-frequency verbs that carry grammar rather than meaning
  'ある',
  'いる',
  'する',
  'なる',
  'できる',
  'いう',
  'くる',
  'いく',
  // auxiliary and aspect endings that the segmenter leaves as separate tokens
  'ます',
  'ました',
  'ません',
  'ている',
  'てい',
  'した',
  'して',
  'ない',
  'なく',
  'たい',
  'れる',
  'られる',
  'せる',
  // demonstratives
  'これ',
  'それ',
  'あれ',
  'この',
  'その',
  'あの',
  'ここ',
  'そこ',
  'あそこ',
  'こう',
  'そう',
  'ああ',
  // interrogatives
  '何',
  'なに',
  'なん',
  '誰',
  'どこ',
  'いつ',
  'どう',
  'なぜ',
  'どの',
  'どれ',
  'いくつ',
  'いくら',
  // pronouns
  '私',
  'わたし',
  '僕',
  '俺',
  'あなた',
  '彼',
  '彼女',
  '自分',
  // conjunctions and connectives
  'そして',
  'しかし',
  'でも',
  'だから',
  'ので',
  'のに',
  'けど',
  'または',
  'たち',
]);

export const ja = {
  name: 'Japanese',
  native: '日本語',
  code: 'ja' as const,
  flag: '\u{1F1EF}\u{1F1F5}',
  ttsCode: 'ja-JP',
  // The lowest-lettered Standard voice, and female, matching the tier and
  // gender af/de/es/pt/ru/pl/zh use.
  ttsVoice: 'ja-JP-Standard-A',
  tatoebaCode: 'jpn',
  fallbackTts: ['ja-JP', 'ja'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'こんにちは。日本語を勉強しています。',
  // Furigana sits in the dictionary's `ipa` column, so the reader prints the
  // kana reading above each word (#289 4.4). Kanji hide their reading, which is
  // the same reason Chinese opts in and Esperanto does not.
  pronunciation: {
    audio: ['google'] as const,
    annotation: 'dictionary' as const,
    // Han only. A kana word already shows its reading, and several single kana
    // are archaic kanji-words in the dictionary, so a lookup returns something
    // unrelated. See the note on annotationRequires.
    annotationRequires: '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]',
    // Kana is no wider than the kanji beneath it, so the annotation sits above
    // the word instead of widening it. Pinyin is wider, which is why zh leaves
    // this off. See annotationOverhang.
    annotationOverhang: true,
  },
  script: {
    // Plain 'ja', not 'ja-JP'. The tag is handed to Intl.Segmenter and to the
    // lang attribute, and neither needs the region. Han unification makes the
    // language subtag load-bearing for glyph choice: the same codepoint renders
    // differently under ja and zh-Hans.
    bcp47: 'ja',
    direction: 'ltr' as const,
    // Japanese writes no spaces, so it takes the same segmenter path Chinese
    // does (#289 Phase 4).
    kind: 'cjk-unspaced' as const,
    // Kana and kanji have no letter case, so foldWord skips lowercasing.
    hasCase: false,
    // Fullwidth terminators. Japanese writes no space after 。 so the unspaced
    // sentence splitter scans instead of requiring one.
    sentenceTerminators: '。．！？!?',
  },
};
