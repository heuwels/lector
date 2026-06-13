'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getVocabStats, setSetting } from '@/lib/data-layer';
import { LANGUAGES } from '@/lib/languages';
import { LanguageCode } from '@/types/language';
import { useActiveLanguage } from '@/utils/hooks';
import { setLanguageInStorage } from '@/utils/storage';

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const activeLang = useActiveLanguage();
  const [knownWordsCount, setKnownWordsCount] = useState<number | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const vocabStats = await getVocabStats();
        const knownCount =
          vocabStats.byState.level3 + vocabStats.byState.level4 + vocabStats.byState.known;
        setKnownWordsCount(knownCount);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    init();
  }, []);

  async function handleSwitch(code: LanguageCode) {
    await setSetting('targetLanguage', code);
    setLanguageInStorage(code);
    window.location.reload();
  }

  const knownBadge = knownWordsCount ? (
    <span
      title="Words known"
      className="rounded-full border border-amber-500 bg-amber-100 px-2 py-1 text-amber-700"
    >
      {knownWordsCount}
    </span>
  ) : null;

  const menuItems = Object.values(LANGUAGES).map((lang) => (
    <DropdownMenuItem
      key={lang.code}
      onClick={() => handleSwitch(lang.code)}
      data-testid={`language-option-${lang.code}`}
      className={lang.code === activeLang.code ? 'font-medium' : undefined}
    >
      <span className="text-lg">{lang.flag}</span>
      <span>{lang.native}</span>
      {lang.code === activeLang.code && <Check className="ml-auto size-4" />}
    </DropdownMenuItem>
  ));

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="language-selector"
          aria-label={`Language: ${activeLang.native}`}
          className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <span>{activeLang.flag}</span>
          <span>{activeLang.code.toUpperCase()}</span>
          {knownBadge}
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label="Select language" className="w-44">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="mx-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="language-selector"
          aria-label={`Language: ${activeLang.native}`}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
        >
          <span className="text-lg">{activeLang.flag}</span>
          <span className="flex-1 text-left">{activeLang.native}</span>
          {knownBadge}
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Select language" className="min-w-44">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
