import { LanguageCode } from "@/types/language";

// TODO: Scope these to the active language
export const EXAMPLE_PROMPTS: Record<LanguageCode, string[]> = {
    af: [
        'What\'s the difference between "hou van" and "hou daarvan"?',
        'When do I use "het" vs "is" for past tense?',
        'How do diminutives work in Afrikaans?',
    ],
    de: [
        'Explain the "case" system in German'
        // TODO
    ],
    es: [
        // TODO
    ],
    fr: [
        'When do I use "tu" vs "vous"?',
        'Explain the difference between "être" and "avoir" as auxiliaries',
        'How does elision work (l\', d\', qu\')?',
    ],
    nl: [
        'When do I use "de" vs "het" as a noun\'s article?',
        'How do separable verbs work (e.g. "opbellen", "meenemen")?',
        'What\'s the difference between "kennen" and "weten"?',
    ],
}