// Korean (#289). Spaced, so the reader tokenizes it with the same engine every
// alphabetic pack uses. Two facts about the dump shape this pack.
//
// The dump enumerates conjugation. 먹다 lists 먹었어요, 먹습니다 and 먹었습니다 in
// its `forms` table, so a verb resolves through the inflections table with no
// analyser. Japanese needed one because ICU severed the stem.
//
// The dump enumerates NO postposition. Korean attaches its grammar to the word
// with no space, so a reader taps 도서관에서 and the dictionary holds 도서관. See
// clitics.

// Korean marks grammar with postpositions and with a small set of bound nouns,
// and those carry the sentence structure. Blanking one in a cloze asks the
// learner to guess syntax rather than vocabulary, and they stay out of the
// answer slot.
//
// A Korean token is an eojeol, so a pronoun arrives with its particle already
// attached. 나 and 나는 are both frequent, and the list holds both. The particles
// are here in their bare form too, because a bound noun takes one directly (것을,
// 수가).
const AVOID_WORDS = new Set([
  // case particles
  '이',
  '가',
  '을',
  '를',
  '은',
  '는',
  '의',
  '에',
  '에서',
  '에게',
  '한테',
  '으로',
  '로',
  '와',
  '과',
  '까지',
  '부터',
  // focus and connective particles
  '도',
  '만',
  '조차',
  '마저',
  '이나',
  '나',
  '라도',
  '처럼',
  '같이',
  '보다',
  '마다',
  // bound nouns, which carry grammar rather than meaning
  '것',
  '거',
  '수',
  '줄',
  '데',
  '바',
  '뿐',
  '채',
  '등',
  '및',
  '것을',
  '것이',
  '것은',
  '거야',
  '걸',
  '게',
  // demonstratives
  '그',
  '이것',
  '그것',
  '저것',
  '여기',
  '거기',
  '저기',
  '이런',
  '그런',
  '저런',
  '이렇게',
  '그렇게',
  // interrogatives
  '무엇',
  '뭐',
  '누구',
  '어디',
  '언제',
  '왜',
  '어떻게',
  '어떤',
  '얼마',
  '몇',
  // pronouns, bare and with the particles they most often take
  '나',
  '난',
  '내',
  '내가',
  '나는',
  '저',
  '제',
  '제가',
  '저는',
  '너',
  '네',
  '넌',
  '네가',
  '너는',
  '우리',
  '우린',
  '우리는',
  '그는',
  '그녀',
  '그녀는',
  '그들',
  '그들은',
  '자기',
  '자신',
  // the high-frequency verbs and adjectives that carry grammar
  '하다',
  '있다',
  '없다',
  '되다',
  '이다',
  '아니다',
  '같다',
  '하는',
  '있는',
  '없는',
  '하고',
  '해서',
  '해요',
  '한다',
  '했다',
  '있어',
  '있어요',
  '있습니다',
  '없어',
  '없어요',
  '해',
  '했어',
  '안',
  '못',
  '않다',
  '않아',
  // conjunctions and connectives
  '그리고',
  '그러나',
  '하지만',
  '그런데',
  '그래서',
  '왜냐하면',
  '또',
  '또는',
  '즉',
]);

export const ko = {
  name: 'Korean',
  native: '한국어',
  code: 'ko' as const,
  flag: '\u{1F1F0}\u{1F1F7}',
  ttsCode: 'ko-KR',
  // The lowest-lettered Standard voice, and female, matching the tier and
  // gender af/de/es/pt/ru/pl/zh/ja use.
  ttsVoice: 'ko-KR-Standard-A',
  tatoebaCode: 'kor',
  fallbackTts: ['ko-KR', 'ko'],
  avoidWords: AVOID_WORDS,
  testPhrase: '안녕하세요. 한국어를 공부하고 있어요.',
  pronunciation: {
    audio: ['google'] as const,
    // No annotation. Hangul is featural and phonemic, so the spelling gives the
    // pronunciation syllable for syllable, and the same reason keeps the layer
    // off Esperanto. zh and ja opt in because Han characters hide the reading.
  },
  script: {
    // Plain 'ko', not 'ko-KR'. The tag feeds the lang attribute and Intl.*, and
    // neither needs the region.
    bcp47: 'ko',
    direction: 'ltr' as const,
    // Korean writes spaces between eojeol, so it needs no segmenter. The class
    // exists for the wrapping rule: a Korean line breaks between eojeol and not
    // inside one.
    kind: 'hangul' as const,
    // Hangul has no letter case, so foldWord skips lowercasing.
    hasCase: false,
  },
  // How a written Korean token reaches a dictionary key. Runs only after the
  // exact key and the inflections table both miss.
  morphology: {
    // Postpositions. The stem is a finished word, so it is looked up as
    // written. Stacks are not listed: the stripper peels up to `maxClitics` in
    // turn, so 에서 and 는 alone take 도서관에서는 to 도서관에서 and then 도서관.
    clitics: [
      // case
      '이',
      '가',
      '을',
      '를',
      '은',
      '는',
      '의',
      '에',
      '에서',
      '서',
      '에게',
      '에게서',
      '한테',
      '한테서',
      '께',
      '으로',
      '로',
      '으로서',
      '로서',
      '으로써',
      '로써',
      '와',
      '과',
      '하고',
      '이랑',
      '랑',
      // focus, comparison and extent
      '도',
      '만',
      '조차',
      '마저',
      '이나',
      '나',
      '라도',
      '이든',
      '커녕',
      '처럼',
      '같이',
      '보다',
      '만큼',
      '부터',
      '까지',
      '마다',
      '밖에',
      '대로',
      // The plural marker, which is a suffix and not a particle, and stacks
      // under one: 여자들은 is 여자 plus 들 plus 은.
      '들',
      // The copula, which attaches to a noun exactly as a particle does.
      // 사람이다 is 사람 plus 이다, and the noun is what a learner wants. These
      // are its conjugated forms, because the copula never appears bare on a
      // noun. The 이 drops after a vowel, which is why 야 and 예요 stand beside
      // 이야 and 이에요.
      '이다',
      '다',
      '입니다',
      '입니까',
      '이에요',
      '예요',
      '이야',
      '야',
      '이었다',
      '이었어요',
      '이었습니다',
      '이라고',
      '라고',
      '이라는',
      '라는',
      '이란',
    ],
    maxClitics: 2,
    // Connective and auxiliary endings. kaikki enumerates the finite forms and
    // none of these, so the stem is peeled and 다 is appended to make the
    // dictionary form. 좋아하지 gives 좋아하, and the entry is 좋아하다.
    //
    // An ending that fuses INTO the last syllable is not here and cannot be.
    // 될 is 되 plus ㄹ written as one syllable, and reaching 되다 from it needs
    // jamo decomposition rather than a string peel.
    endings: [
      // sentence-final, polite and formal
      '습니다',
      '습니까',
      '었습니다',
      '았습니다',
      '겠습니다',
      '으세요',
      '세요',
      '어요',
      '아요',
      '여요',
      '네요',
      '군요',
      '나요',
      '까요',
      '을까요',
      '지요',
      // connective
      '으니까',
      '니까',
      '으면',
      '면',
      '어서',
      '아서',
      '지만',
      '는데',
      '은데',
      '으려고',
      '려고',
      '으러',
      '러',
      '다면',
      '다고',
      '거든',
      '더라',
      '고',
      '지',
      '지는',
      '도록',
      '잖아',
      '자마자',
      '으려면',
      '려면',
      // The past tense the dump leaves out. It lists 했다 for 하다 and not
      // 되었다 for 되다, so the plain 었다 and 았다 have to come off.
      '었다',
      '았다',
      '였다',
      '었어',
      '았어',
      '었어요',
      '았어요',
      '었으면',
      '았으면',
      // nominal and adnominal
      '는지',
      '은지',
      '을지',
      '을까',
      '기',
      '음',
      '게',
      '던',
      // The adnominal endings are postpositions as well, so the peel is the
      // same and the key is not: 사람은 wants 사람, and 좋은 wants 좋다. Both are
      // proposed, and the clitic reading is proposed first.
      '은',
      '는',
      '을',
      '을래',
      '을게',
      '을수록',
      '는데요',
      // the bare stem vowels, last because they match the most words
      '어',
      '아',
      '여',
    ],
    citation: '다',
    minStem: 1,
  },
};
