import { useEffect, useRef, useState } from "react";
import { getVocabStats, setSetting } from "@/lib/data-layer";
import { LANGUAGES } from "@/lib/languages";
import { LanguageCode } from "@/types/language";
import { useActiveLanguage } from "@/utils/hooks";
import { setLanguageInStorage } from "@/utils/storage";
import { ChevronIcon } from "../icons";

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const activeLang = useActiveLanguage();
    const [knownWordsCount, setKnownWordsCount] = useState<number | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        function handleClick(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setIsOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    useEffect(() => {
        const init = async () => {
            try {
                const vocabStats = await getVocabStats();
                const knownCount =
                    vocabStats.byState.level3 +
                    vocabStats.byState.level4 +
                    vocabStats.byState.known;
                setKnownWordsCount(knownCount);

            } catch (error) {
                console.error('Error loading data:', error);
            }
        }

        init();
    }, [])

    async function handleSwitch(code: LanguageCode) {
        setIsOpen(false);
        await setSetting('targetLanguage', code);
        setLanguageInStorage(code);
        window.location.reload();
    }

    const allLangs = Object.values(LANGUAGES);

    if (compact) {
        return (
            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                    aria-label={`Language: ${activeLang.native}`}
                    data-testid="language-selector"
                    className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                    <span>{activeLang.flag}</span>
                    <span>{activeLang.code.toUpperCase()}</span>
                    {knownWordsCount && <span title='Words known' className='py-1 px-2 bg-amber-100 rounded-full text-amber-700 border border-amber-500'>{knownWordsCount}</span>}
                    <ChevronIcon />
                </button>
                {isOpen && (
                    <div role="listbox" aria-label="Select language" className="absolute left-0 z-50 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                        {allLangs.map((lang) => (
                            <button
                                role="option"
                                aria-selected={lang.code === activeLang.code}
                                key={lang.code}
                                onClick={() => handleSwitch(lang.code)}
                                data-testid={`language-option-${lang.code}`}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${lang.code === activeLang.code
                                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700'
                                    }`}
                            >
                                <span>{lang.flag}</span>
                                <span>{lang.native}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="relative mx-3" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-label={`Language: ${activeLang.native}`}
                data-testid="language-selector"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
            >
                <span className="text-lg">{activeLang.flag}</span>
                <span className="flex-1 text-left">{activeLang.native}</span>
                {knownWordsCount && <span title='Words known' className='py-1 px-2 bg-amber-100 rounded-full text-amber-700 border border-amber-500'>{knownWordsCount}</span>}
                <ChevronIcon />
            </button>
            {isOpen && (
                <div role="listbox" aria-label="Select language" className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {allLangs.map((lang) => (
                        <button
                            role="option"
                            aria-selected={lang.code === activeLang.code}
                            key={lang.code}
                            onClick={() => handleSwitch(lang.code)}
                            data-testid={`language-option-${lang.code}`}
                            className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${lang.code === activeLang.code
                                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700'
                                }`}
                        >
                            <span className="text-lg">{lang.flag}</span>
                            <span>{lang.native}</span>

                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
