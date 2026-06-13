// Expand a selection to full word boundaries (pure function, no deps)
export function snapToWordBoundaries(selection: Selection): string {
    const range = selection.getRangeAt(0);

    const startContainer = range.startContainer;
    if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.textContent || '';
        let start = range.startOffset;
        while (start > 0 && /[\wêëéèôöûüîïáà''ʼ`\-]/.test(text[start - 1])) {
            start--;
        }
        range.setStart(startContainer, start);
    }

    const endContainer = range.endContainer;
    if (endContainer.nodeType === Node.TEXT_NODE) {
        const text = endContainer.textContent || '';
        let end = range.endOffset;
        while (end < text.length && /[\wêëéèôöûüîïáà''ʼ`\-]/.test(text[end])) {
            end++;
        }
        range.setEnd(endContainer, end);
    }

    return range.toString().trim();
}
