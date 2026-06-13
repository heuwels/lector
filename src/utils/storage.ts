import { LANGUAGE_CHANGE_EVENT } from "@/constants/storage";
import { DEFAULT_LANGUAGE, isValidLanguageCode, LANGUAGES } from "@/lib/languages";
import { LanguageConfig } from "@/types/language";

export function subscribeToStorage(callback: () => void) {
    window.addEventListener('storage', callback);
    window.addEventListener(LANGUAGE_CHANGE_EVENT, callback);

    return () => {
        window.removeEventListener('storage', callback);
        window.removeEventListener(LANGUAGE_CHANGE_EVENT, callback);
    };
}

export function setLanguageInStorage(code: string) {
    localStorage.setItem('lector-target-language', code);
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

export function getLanguageSnapshot(): LanguageConfig {
    const stored = localStorage.getItem('lector-target-language') as keyof typeof LANGUAGES | null;
    if (stored && isValidLanguageCode(stored)) return LANGUAGES[stored];
    return LANGUAGES[DEFAULT_LANGUAGE];
}
