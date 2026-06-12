export type LanguageCode = 'af' | 'de' | 'es';

export interface LanguageConfig {
    name: string;
    native: string;
    code: LanguageCode;
    flag: string;
    ttsCode: string;
    ttsVoice: string;
    tatoebaCode: string;
    fallbackTts: string[];
    avoidWords: Set<string>;
    testPhrase: string;
}