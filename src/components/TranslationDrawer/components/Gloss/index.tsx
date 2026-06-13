import { findNestedWordRef } from "@/lib/definition-links";
import NestedWordButton from "../NestedWordButton";

/** 
 * A sense gloss with its form-of reference ("plural of vrug") 
 * linkified when a lookup callback is available; plain text otherwise. 
 * */
export default function Gloss({
    text,
    onLookupWord,
}: {
    text: string;
    onLookupWord?: (word: string) => void;
}) {
    const ref = onLookupWord ? findNestedWordRef(text) : null;
    if (!ref || !onLookupWord) return <>{text}</>;

    return (
        <>
            {ref.prefix}
            <NestedWordButton word={ref.word} onLookupWord={onLookupWord} testId="nested-word-link" />
            {ref.suffix}
        </>
    );
}