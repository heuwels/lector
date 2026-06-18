import { isValidElement, type ReactNode, type ReactElement } from 'react';

// Expand a selection to full word boundaries (pure function, no deps)
export function snapToWordBoundaries(selection: Selection): string {
    const range = selection.getRangeAt(0);

    const startContainer = range.startContainer;
    if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.textContent || '';
        let start = range.startOffset;
        while (start > 0 && /[\wêëéèôöûüîïáà'‘’ʼ`\-]/.test(text[start - 1])) {
            start--;
        }
        range.setStart(startContainer, start);
    }

    const endContainer = range.endContainer;
    if (endContainer.nodeType === Node.TEXT_NODE) {
        const text = endContainer.textContent || '';
        let end = range.endOffset;
        while (end < text.length && /[\wêëéèôöûüîïáà'‘’ʼ`\-]/.test(text[end])) {
            end++;
        }
        range.setEnd(endContainer, end);
    }

    return range.toString().trim();
}

// Matches a vocab "word": the Afrikaans 'n article, or a (possibly hyphenated)
// run of letters including accented chars. Shared by the reader's tokenizer so
// word indices line up between collection and rendering.
export const WORD_PATTERN = /['‘’ʼ`]n\b|[\wêëéèôöûüîïáà]+(?:-[\wêëéèôöûüîïáà]+)*/gi;

export interface TextPart {
    text: string;
    isWord: boolean;
}

/** Split a string into alternating word / non-word parts (pure). */
export function splitWords(text: string): TextPart[] {
    const parts: TextPart[] = [];
    const re = new RegExp(WORD_PATTERN); // fresh instance → own lastIndex
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ text: text.slice(lastIndex, match.index), isWord: false });
        }
        parts.push({ text: match[0], isWord: true });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        parts.push({ text: text.slice(lastIndex), isWord: false });
    }
    return parts;
}

/**
 * Collect a react-markdown block's words in document order, splitting each
 * string leaf exactly the way the renderer does — including words nested inside
 * inline elements (<strong>/<em>/<a>/…). The resulting order matches the spans
 * produced during rendering, so phrase-highlight indices line up.
 */
export function collectWords(children: ReactNode): string[] {
    if (typeof children === 'string') {
        return splitWords(children).filter((p) => p.isWord).map((p) => p.text);
    }
    if (Array.isArray(children)) {
        return children.flatMap(collectWords);
    }
    if (isValidElement(children)) {
        return collectWords((children as ReactElement<{ children?: ReactNode }>).props.children);
    }
    return [];
}

/**
 * Indices (into a block's word list) covered by the currently highlighted
 * phrase. Matches the first contiguous, case-insensitive run. Empty phrase or
 * no match → empty set.
 */
export function computePhraseHighlightSet(blockWords: string[], phrase: string[]): Set<number> {
    const set = new Set<number>();
    if (phrase.length === 0 || phrase.length > blockWords.length) return set;
    for (let i = 0; i <= blockWords.length - phrase.length; i++) {
        let matches = true;
        for (let j = 0; j < phrase.length; j++) {
            if (blockWords[i + j].toLowerCase() !== phrase[j]) {
                matches = false;
                break;
            }
        }
        if (matches) {
            for (let j = 0; j < phrase.length; j++) set.add(i + j);
            return set;
        }
    }
    return set;
}
