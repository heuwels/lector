// Re-export of the shared language layer (`languages/`), the single source of
// truth shared with the Hono API. Add or edit a language in the registry;
// tokenization/folding/grapheme helpers live alongside it (#289).
export * from '../../languages/registry';
export * from '../../languages/text';
export * from '../../languages/graphemes';
export * from '../../languages/tokenizer';
