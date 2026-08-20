// Mandarin Chinese (#213). This is the REGISTRY SLICE ONLY — the data pipeline
// (kaikki dictionary, pinyin extraction, Simplified/Traditional keying, cloze
// bank, frequency bands) is still #213's own work and none of it is here yet.
// It exists so the `cjk-unspaced` reader path built in #289 Phase 4 has a real
// language behind it: without a registered pack there is no way to hold, read
// or test a single character of Chinese content.
//
// Consequences of the missing data, all expected until #213 lands:
//   - No on-device dictionary, so tap-to-define falls through to the LLM path.
//   - No sentence bank, so cloze practice seeds nothing (SENTENCE_BANKS has no
//     'zh' key, and loadSentenceBank returns [] for an unregistered code).
//   - No frequency data, so `avoidWords` below is a hand-written starter set.

// Chinese has no articles and no inflection; the function-word load is
// particles, pronouns, coverbs and measure words. Blanking any of these in a
// cloze teaches nothing, so they stay out of the answer slot.
const AVOID_WORDS = new Set([
  // structural and aspect particles
  '的',
  '了',
  '着',
  '过',
  '得',
  '地',
  '所',
  '之',
  // pronouns
  '我',
  '你',
  '您',
  '他',
  '她',
  '它',
  '我们',
  '你们',
  '他们',
  '她们',
  '自己',
  // demonstratives and interrogatives
  '这',
  '那',
  '这个',
  '那个',
  '这些',
  '那些',
  '什么',
  '谁',
  '哪',
  '哪个',
  '怎么',
  '为什么',
  '多少',
  '几',
  // coverbs and prepositions
  '在',
  '从',
  '到',
  '给',
  '对',
  '把',
  '被',
  '跟',
  '和',
  '与',
  '向',
  '为',
  '用',
  '于',
  // copula, existentials and common auxiliaries
  '是',
  '有',
  '没',
  '没有',
  '不',
  '会',
  '能',
  '可以',
  '要',
  '想',
  '就',
  '也',
  '都',
  '很',
  '还',
  '又',
  '再',
  '已经',
  // conjunctions and sentence-final particles
  '但',
  '但是',
  '因为',
  '所以',
  '如果',
  '而',
  '或',
  '吗',
  '呢',
  '吧',
  '啊',
  // the most common measure word
  '个',
]);

export const zh = {
  name: 'Mandarin Chinese',
  native: '中文',
  code: 'zh' as const,
  flag: '\u{1F1E8}\u{1F1F3}',
  ttsCode: 'cmn-CN',
  // Google names the Mandarin locale cmn-CN, not zh-CN. Standard-A is the
  // lowest-lettered Standard voice and is female, matching the tier + gender
  // af/de/es/pt/ru/pl use.
  ttsVoice: 'cmn-CN-Standard-A',
  tatoebaCode: 'cmn',
  fallbackTts: ['zh-CN', 'zh-Hans', 'zh'],
  avoidWords: AVOID_WORDS,
  testPhrase: '你好！你好吗？',
  pronunciation: { audio: ['google'] as const },
  script: {
    // zh-Hans, not bare zh: it selects Simplified glyph forms and the
    // Simplified ICU segmentation dictionary. Han unification means the tag is
    // load-bearing rather than cosmetic — the same codepoint renders
    // differently under zh-Hans, zh-Hant and ja.
    bcp47: 'zh-Hans',
    direction: 'ltr' as const,
    // The whole reason this pack can exist yet: #289 4.1 wired the segmenter
    // engine, 4.2 the stored word list, 4.3 the cloze token index.
    kind: 'cjk-unspaced' as const,
    // No letter case, so foldWord skips lowercasing entirely.
    hasCase: false,
    // Fullwidth terminators. Chinese prose writes no space after 。 so the
    // unspaced sentence splitter (#289 4.1) scans instead of requiring one.
    sentenceTerminators: '。．！？!?',
  },
};
