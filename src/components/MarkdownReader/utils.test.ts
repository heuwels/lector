import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { splitWords, collectWords, computePhraseHighlightSet } from './utils';

const words = (text: string) => splitWords(text).filter((p) => p.isWord).map((p) => p.text);

describe('splitWords', () => {
    it('extracts words and leaves punctuation/whitespace as non-word parts', () => {
        expect(words('Die son sak agter die berge.')).toEqual([
            'Die', 'son', 'sak', 'agter', 'die', 'berge',
        ]);
    });

    it('is lossless — joining all parts reconstructs the input', () => {
        const input = 'Sy dink: "wat nou?" en stap weg.';
        expect(splitWords(input).map((p) => p.text).join('')).toBe(input);
    });

    it('keeps hyphenated and accented words whole', () => {
        expect(words('Reen bring verligting vir die Wes-Kaap')).toContain('Wes-Kaap');
        expect(words('more is donker en moeilik')).toEqual(['more', 'is', 'donker', 'en', 'moeilik']);
    });

    it('treats the Afrikaans n-article as one word (for the apostrophes the pattern supports)', () => {
        // The shared pattern matches straight (U+0027) and modifier (U+02BC)
        // apostrophes, not the curly U+2019 the importer often emits — that gap
        // is a separate, intentionally-untouched follow-up.
        const straight = String.fromCharCode(0x27);
        const modifier = String.fromCharCode(0x02bc);
        expect(words(`${straight}n hond`)).toEqual([`${straight}n`, 'hond']);
        expect(words(`${modifier}n kat`)).toEqual([`${modifier}n`, 'kat']);
    });
});

describe('collectWords', () => {
    it('flattens words across strings and inline elements in document order', () => {
        // "die son is **baie mooi** vandag" as react-markdown would pass it
        const children = [
            'die son is ',
            createElement('strong', { key: 's' }, 'baie mooi'),
            ' vandag',
        ];
        expect(collectWords(children)).toEqual(['die', 'son', 'is', 'baie', 'mooi', 'vandag']);
    });

    it('recurses into nested inline elements', () => {
        const children = createElement(
            'em',
            null,
            'sag ',
            createElement('strong', null, 'wind'),
        );
        expect(collectWords(children)).toEqual(['sag', 'wind']);
    });

    it('ignores non-text leaves', () => {
        expect(collectWords([null, false, undefined, 123, 'hond'])).toEqual(['hond']);
    });
});

describe('computePhraseHighlightSet', () => {
    const block = ['die', 'son', 'sak', 'die', 'bloue', 'berge'];

    it('marks the first contiguous run of the phrase', () => {
        expect([...computePhraseHighlightSet(block, ['sak', 'die'])]).toEqual([2, 3]);
    });

    it('is case-insensitive', () => {
        expect([...computePhraseHighlightSet(['Die', 'Son'], ['die', 'son'])]).toEqual([0, 1]);
    });

    it('returns empty for no match, empty phrase, or over-long phrase', () => {
        expect(computePhraseHighlightSet(block, ['kat']).size).toBe(0);
        expect(computePhraseHighlightSet(block, []).size).toBe(0);
        expect(computePhraseHighlightSet(['een'], ['een', 'twee']).size).toBe(0);
    });
});
